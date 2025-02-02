import {
  GuardOptions,
  GuardMode,
  GuardEventsCamelToKebabMapping,
  GuardLocalConfig,
  GuardEventListeners,
  GuardEvents,
  GuardEventsKebabToCamelType,
  StartWithRedirectOptions,
  AuthenticationClient,
  JwtTokenStatus,
  User,
  Lang,
  IGuardConfig,
  LogoutParams,
  IChangeViewOptions
} from './types'

import { GuardComponent } from './Guard'

import { React, render, unmount } from 'shim-react'

const isDef = (value: unknown) => value !== undefined

export * from './types'

export * from './Guard'

export class Guard {
  public options: GuardOptions

  private visible = false

  private then: () => Promise<any | never>

  private publicConfig?: Record<string, unknown>

  constructor(options: GuardOptions) {
    if (!options.appId) {
      throw new Error('appId is required')
    }

    const config = {
      ...options.config
    }

    this.options = this.adaptOptions(options, config)

    const init = (async () => {
      if (this.publicConfig) {
        return this.publicConfig
      }

      const publicConfigRes = await this.getPublicConfig()

      return (this.publicConfig = publicConfigRes.data)
    })()

    this.then = init.then.bind(init)

    this.visible = !!(options.mode === GuardMode.Modal)
  }

  private adaptOptions(options: GuardOptions, config: Partial<IGuardConfig>) {
    options.host = options.host || ''

    if (isDef(options.isSSO)) {
      config.isSSO = options.isSSO
    }

    if (isDef(options.defaultScene)) {
      // @ts-ignore
      config.defaultScenes = options.defaultScene
    }

    if (isDef(options.lang)) {
      config.lang = options.lang
    }

    if (isDef(options.host)) {
      config.host = options.host
    }

    if (isDef(options.mode)) {
      // @ts-ignore
      config.mode = options.mode
    }

    options.config = config

    if (isDef(options.config.socialConnectionList)) {
      // @ts-ignore
      options.config.socialConnections = options.config.socialConnectionList
    }

    if (isDef(options.config.loginMethod)) {
      // @ts-ignore
      options.config.defaultLoginMethod = options.config.loginMethod
    }

    if (isDef(options.config.loginMethodList)) {
      // @ts-ignore
      options.config.loginMethods = options.config.loginMethodList
    }

    if (isDef(options.config.registerMethodList)) {
      // @ts-ignore
      options.config.registerMethods = options.config.registerMethodList
    }

    if (isDef(options.config.registerMethod)) {
      // @ts-ignore
      options.config.defaultRegisterMethod = options.config.registerMethod
    }

    if (isDef(options.config.contentCSS)) {
      options.config.contentCss = options.config.contentCSS
    }

    return options
  }

  private async getPublicConfig(): Promise<{
    [prop: string]: any
  }> {
    const host = `${this.options.host}` || 'https://core.authing.cn'

    const options: RequestInit = {
      method: 'GET',
      credentials: 'include'
    }

    const fetchRes = await fetch(
      `${host}/api/v2/applications/${this.options.appId}/public-config`,
      options
    )

    const publicConfig = await fetchRes.text()

    return JSON.parse(publicConfig)
  }

  private async getRequestHost() {
    if (this.options.host) {
      return this.options.host
    }

    const publicConfig = await this.then()
    if (publicConfig.requestHostname) {
      return `https://${publicConfig.requestHostname}`
    }

    return 'https://core.authing.cn'
  }

  async getAuthClient(): Promise<AuthenticationClient> {
    let publicConfig = {} as any

    try {
      publicConfig = await this.then()
    } catch (e) {
      throw new Error(JSON.stringify(e))
    }

    const requestHostname = await this.getRequestHost()

    const _authClientOptions = Object.assign(
      {},
      {
        appId: this.options.appId,
        appHost: requestHostname,
        tenantId: this.options.tenantId,
        redirectUri:
          this.options.redirectUri || publicConfig.oidcConfig.redirect_uris[0],
        tokenEndPointAuthMethod:
          publicConfig.oidcConfig.token_endpoint_auth_method || 'none',
        introspectionEndPointAuthMethod:
          publicConfig.oidcConfig.introspection_endpoint_auth_method || 'none'
      }
    )

    return new AuthenticationClient(_authClientOptions)
  }

  static getGuardContainer(selector?: string | HTMLElement): Element | null {
    const defaultId = 'authing_guard_container'

    if (!selector) {
      let container = document.querySelector(`#${defaultId}`)
      if (!container) {
        container = document.createElement('div')
        container.id = defaultId
        document.body.appendChild(container)
      }

      return container
    }

    if (typeof selector === 'string') {
      const res = document.querySelector(selector)
      if (!res) {
        console.warn(
          `Failed to start guard: target selector "${selector}" returned null.`
        )
      }
      return res
    }

    return selector
  }

  private eventListeners = Object.values(GuardEventsCamelToKebabMapping).reduce(
    (acc, evtName) => {
      return Object.assign({}, acc, {
        [evtName as string]: []
      })
    },
    {} as GuardEventListeners
  )

  /**
   * 启动嵌入模式
   * @param el String
   * @returns Promise
   */
  async start(el?: string): Promise<User> {
    ;(this.options.config as Partial<GuardLocalConfig>).target = el

    this._render()

    const userInfo = await this.trackSession()

    if (userInfo) {
      return Promise.resolve(userInfo)
    }

    return new Promise(resolve => {
      this.on('login', userInfo => {
        resolve(userInfo)
      })
    })
  }

  startRegister() {
    this.changeView('register')
  }

  async checkLoginStatus(): Promise<JwtTokenStatus | undefined> {
    // 与嵌入式登录保持一致，使用 JS SDK 缓存 token 及用户信息
    const authClient = await this.getAuthClient()

    const userInfo = await this.trackSession()

    if (!userInfo) {
      return
    }

    authClient.tokenProvider.setUser(userInfo)

    // 兼容老版本
    const accessToken = localStorage.getItem('accessToken')

    if (!accessToken) {
      return
    }

    const requestHostname = await this.getRequestHost()

    const options: RequestInit = {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        token: accessToken
      })
    }

    try {
      const fetchRes = await fetch(
        `${requestHostname}/api/v2/users/login/check-status`,
        options
      )

      const loginStatusText = await fetchRes.text()

      const loginStatus: JwtTokenStatus = JSON.parse(loginStatusText)

      if (loginStatus.code === 200 && loginStatus.status === true) {
        return loginStatus
      }
    } catch (e) {
      return
    }
  }

  changeLang(lang: Lang) {
    this.options.lang = lang

    this.options.config = Object.assign({}, this.options.config, {
      lang
    })

    this.unmount()
    this._render()
  }

  changeContentCSS(contentCSS: string) {
    this.options.config = Object.assign({}, this.options.config, {
      contentCss: contentCSS
    })

    this.unmount()
    this._render()
  }

  /**
   * 启动跳转模式
   */
  async startWithRedirect(options: StartWithRedirectOptions = {}) {
    const getRandom = () => Math.random().toString().slice(2)

    const {
      codeChallengeMethod = 'S256',
      scope = 'openid profile email phone address',
      state = getRandom(),
      nonce = getRandom(),
      responseMode = 'query',
      responseType = 'code'
    } = options

    const authClient = await this.getAuthClient()

    // 生成一个 code_verifier
    const codeChallenge = authClient.generateCodeChallenge()

    localStorage.setItem('codeChallenge', codeChallenge)

    // 计算 code_verifier 的 SHA256 摘要
    const codeChallengeDigest = authClient.getCodeChallengeDigest({
      codeChallenge,
      method: codeChallengeMethod
    })

    let publicConfig = {} as any

    try {
      publicConfig = await this.then()
    } catch (e) {
      throw new Error(JSON.stringify(e))
    }

    // 构造 OIDC 授权码 + PKCE 模式登录 URL
    const url = authClient.buildAuthorizeUrl({
      codeChallenge: codeChallengeDigest,
      codeChallengeMethod,
      scope,
      redirectUri:
        this.options.redirectUri || publicConfig.oidcConfig.redirect_uris[0],
      state,
      nonce,
      responseMode,
      responseType
    })

    window.location.href = url
  }

  async handleRedirectCallback() {
    const { code, codeChallenge } = this.getCodeAndCodeChallenge()

    const { id_token, access_token } = await this.getAccessTokenByCode(
      code,
      codeChallenge
    )

    this.setTokenCache(access_token, id_token)
  }

  private async getAccessTokenByCode(code: string, codeChallenge: string) {
    const authClient = await this.getAuthClient()

    return await authClient.getAccessTokenByCode(code, {
      codeVerifier: codeChallenge
    })
  }

  private getCodeAndCodeChallenge() {
    const query = this.parseUrlQuery()
    const { code = '' } = query
    const codeChallenge = localStorage.getItem('codeChallenge') || ''

    return {
      code,
      codeChallenge
    }
  }

  private setTokenCache(accessToken: string, idToken: string) {
    localStorage.setItem('accessToken', accessToken)
    localStorage.setItem('idToken', idToken)
  }

  private clearTokenCache() {
    localStorage.removeItem('accessToken')
    localStorage.removeItem('idToken')
  }

  private async clearLoginCache() {
    const authClient = await this.getAuthClient()
    localStorage.removeItem('codeChallenge')
    authClient.tokenProvider.clearUser()
    this.clearTokenCache()
  }

  private parseUrlQuery() {
    const query: Record<string, string> = {}

    let queryString = ''

    try {
      queryString = window.location.search.split('?')[1]
    } catch (e) {
      queryString = window.location.hash.split('#')[1]
    }

    if (!queryString) {
      return query
    }

    queryString.split('&').forEach(item => {
      const [key, value] = item.split('=')
      query[key] = value
    })

    return query
  }

  /**
   * 获取当前用户信息
   */
  async trackSession(): Promise<User | null> {
    const authClient = await this.getAuthClient()

    const user = await authClient.getCurrentUser()

    if (user) {
      return user
    }

    const idToken =
      authClient.tokenProvider.getToken() ||
      localStorage.getItem('idToken') ||
      ''

    if (!idToken) {
      return null
    }

    const publicConfig = await this.then()

    const requestHostname = await this.getRequestHost()

    const options: RequestInit = {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'x-authing-userpool-id': publicConfig.userPoolId,
        Authorization: idToken
      }
    }

    try {
      const fetchRes = await fetch(
        `${requestHostname}/api/v2/users/me`,
        options
      )

      const userInfoText = await fetchRes.text()

      const { code, data } = JSON.parse(userInfoText)

      if (code === 200) {
        return data
      }

      return null
    } catch (e) {
      return null
    }
  }

  async logout(params: LogoutParams = {}) {
    let logoutRedirectUri = ''
    const { redirectUri, quitCurrentDevice } = params
    const { logoutRedirectUris } = await this.then()
    const origin = window.location.origin

    try {
      logoutRedirectUri =
        redirectUri && logoutRedirectUris.indexOf(redirectUri) > -1
          ? redirectUri
          : logoutRedirectUris[0] || origin
    } catch (e) {
      logoutRedirectUri = origin
    }

    const authClient = await this.getAuthClient()

    try {
      if (quitCurrentDevice) {
        await authClient.logoutCurrent()
      } else {
        await authClient.logout()
      }
    } catch (error) {
      // 兜底 redirect 场景下，Safari 和 Firefox 开启『阻止跨站跟踪』后无法退出
      // 此方法只能退出当前设备
      const idToken =
        authClient.tokenProvider.getToken() || localStorage.getItem('idToken')
      if (idToken) {
        logoutRedirectUri = authClient.buildLogoutUrl({
          expert: true,
          redirectUri: logoutRedirectUri,
          idToken
        })
      }
    } finally {
      await this.clearLoginCache()
      window.location.href = logoutRedirectUri
    }
  }

  async _render() {
    const evts: GuardEvents = Object.entries(
      GuardEventsCamelToKebabMapping
    ).reduce((acc, [reactEvt, nativeEvt]) => {
      return Object.assign({}, acc, {
        [reactEvt]: (...rest: any) => {
          if (nativeEvt === 'close') {
            this.hide()
          }

          // TODO 返回最后一个执行函数的值，实际应该只让监听一次
          return (
            (this.eventListeners as any)[nativeEvt as string]
              .map((item: any) => {
                return item(...rest)
              })
              .slice(-1)[0] ?? true
          )
        }
      })
    }, {} as GuardEvents)

    const authClient = await this.getAuthClient()

    if (this.options.config) {
      const requestHostname = await this.getRequestHost()
      this.options.config.host = requestHostname
    }

    render({
      container: Guard.getGuardContainer(
        this.options.config?.target
      ) as Element,
      element: (
        <GuardComponent
          {...(evts as GuardEvents)}
          appId={this.options.appId}
          tenantId={this.options.tenantId}
          config={{
            ...this.options.config,
            style: this.options.style ?? this.options.config?.style ?? {}
          }}
          facePlugin={this.options.facePlugin}
          appendConfig={this.options.appendConfig}
          visible={this.visible}
          authClient={authClient}
        />
      )
    })
  }

  on<T extends keyof GuardEventsKebabToCamelType>(
    evt: T,
    handler: Exclude<GuardEventsKebabToCamelType[T], undefined>
  ) {
    ;(this.eventListeners as any)[evt].push(handler as any)
  }

  show() {
    this.visible = true
    this._render()
  }

  hide() {
    this.visible = false
    this._render()
  }

  unmount() {
    const node = Guard.getGuardContainer(this.options.config?.target)

    if (node) {
      unmount(node)
    }
  }

  getCurrentView() {
    return {
      currentModule: window.$$guard.viewContext?.currentModule,
      currentTab: window.$$guard.viewContext?.currentTab
    }
  }

  async changeView(currentView: string | IChangeViewOptions) {
    let moduleName = ''
    let tabName: undefined | string = ''

    if (typeof currentView === 'string') {
      const arr = currentView.split(':')
      moduleName = arr[0]
      tabName = arr[1]
    } else {
      moduleName = currentView.module
      tabName = currentView.tab
    }

    if (
      !window.$$guard.viewContext ||
      !window.$$guard.viewContext.changeModule
    ) {
      return
    }

    await window.$$guard.viewContext?.changeModule(moduleName)

    if (!tabName) {
      return
    }

    requestIdleCallback(() => {
      window.$$guard.viewContext?.changeTab(tabName)
    })
  }

  private getAgreementsContext() {
    return window.$$guard.agreementsContext
  }

  checkAllAgreements() {
    const agreementsContext = this.getAgreementsContext()
    agreementsContext?.checkAllAgreements()
  }

  unCheckAllAgreements() {
    const agreementsContext = this.getAgreementsContext()
    agreementsContext?.unCheckAllAgreements()
  }
}
