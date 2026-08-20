import type { OAuthProvider } from '@sage-burner/shared'
import type { ComponentChildren } from 'preact'

import { oauthProviders } from '@sage-burner/shared'
import { createContext } from 'preact'
import { useContext, useEffect, useState } from 'preact/hooks'

import type { ApiClient } from './api/client.ts'

interface InstallationContextValue {
  title?: string
  banner?: string | null
  icon?: string | null
  sendsEmail?: boolean
  knowsOwnAddress?: boolean
  unreachable?: boolean
  socialLogins?: readonly OAuthProvider[]
  setTitle: (title: string) => void
  setBanner: (banner: string | null) => void
  setIcon: (icon: string | null) => void
  setSendsEmail: (sends: boolean) => void
  setProviderConfigured: (provider: OAuthProvider, configured: boolean) => void
}

const InstallationContext = createContext<InstallationContextValue>({
  setTitle: () => undefined,
  setBanner: () => undefined,
  setIcon: () => undefined,
  setSendsEmail: () => undefined,
  setProviderConfigured: () => undefined,
})

const Provide = ({
  title,
  banner,
  icon,
  sendsEmail,
  knowsOwnAddress,
  unreachable,
  socialLogins,
  children,
}: {
  title?: string
  banner?: string | null
  icon?: string | null
  sendsEmail?: boolean
  knowsOwnAddress?: boolean
  unreachable?: boolean
  socialLogins?: readonly OAuthProvider[]
  children: ComponentChildren
}) => {
  const [override, setOverride] = useState<string | undefined>(undefined)
  const [bannerOverride, setBannerOverride] = useState<string | null | undefined>(undefined)
  const [iconOverride, setIconOverride] = useState<string | null | undefined>(undefined)
  const [mailOverride, setMailOverride] = useState<boolean | undefined>(undefined)
  const [loginsOverride, setLoginsOverride] = useState<readonly OAuthProvider[] | undefined>(undefined)
  const current = override ?? title

  useEffect(() => {
    if (current !== undefined) document.title = current
  }, [current])

  return (
    <InstallationContext.Provider
      value={{
        title: current,
        banner: bannerOverride === undefined ? banner : bannerOverride,
        icon: iconOverride === undefined ? icon : iconOverride,
        sendsEmail: mailOverride ?? sendsEmail,
        knowsOwnAddress,
        unreachable,
        socialLogins: loginsOverride ?? socialLogins,
        setTitle: setOverride,
        setBanner: setBannerOverride,
        setIcon: setIconOverride,
        setSendsEmail: setMailOverride,
        setProviderConfigured: (provider, configured) =>
          setLoginsOverride((held) => {
            const effective = held ?? socialLogins ?? []

            return oauthProviders.filter((candidate) =>
              candidate === provider ? configured : effective.includes(candidate),
            )
          }),
      }}
    >
      {children}
    </InstallationContext.Provider>
  )
}

export const InstallationProvider = ({
  children,
  title,
  banner,
  icon,
  sendsEmail,
  knowsOwnAddress,
  unreachable,
  socialLogins,
}: {
  children: ComponentChildren
  title?: string
  banner?: string | null
  icon?: string | null
  sendsEmail?: boolean
  knowsOwnAddress?: boolean
  unreachable?: boolean
  socialLogins?: readonly OAuthProvider[]
}) => (
  <Provide
    title={title}
    banner={banner}
    icon={icon}
    sendsEmail={sendsEmail}
    knowsOwnAddress={knowsOwnAddress}
    unreachable={unreachable}
    socialLogins={socialLogins}
  >
    {children}
  </Provide>
)

export const FetchedInstallationProvider = ({
  children,
  api,
}: {
  children: ComponentChildren
  api: Pick<ApiClient, 'getInstallation'>
}) => {
  const [title, setTitle] = useState<string | undefined>(undefined)
  const [banner, setBanner] = useState<string | null | undefined>(undefined)
  const [icon, setIcon] = useState<string | null | undefined>(undefined)
  const [sendsEmail, setSendsEmail] = useState<boolean | undefined>(undefined)
  const [knowsOwnAddress, setKnowsOwnAddress] = useState<boolean | undefined>(undefined)
  const [unreachable, setUnreachable] = useState(false)
  const [socialLogins, setSocialLogins] = useState<readonly OAuthProvider[] | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()

    api
      .getInstallation(controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return
        setTitle(response.installation.title)
        setBanner(response.installation.banner_updated_at)
        setIcon(response.installation.icon_updated_at)
        setSendsEmail(response.installation.sends_email)
        setKnowsOwnAddress(response.installation.knows_own_address)
        setSocialLogins(response.installation.social_logins)
      })
      .catch(() => {
        if (!controller.signal.aborted) setUnreachable(true)
      })

    return () => {
      controller.abort()
    }
  }, [api])

  return (
    <Provide
      title={title}
      banner={banner}
      icon={icon}
      sendsEmail={sendsEmail}
      knowsOwnAddress={knowsOwnAddress}
      unreachable={unreachable}
      socialLogins={socialLogins}
    >
      {children}
    </Provide>
  )
}

export const useInstallationTitle = () => useContext(InstallationContext).title

export const useInstallationBanner = () => useContext(InstallationContext).banner

export const useSetInstallationTitle = () => useContext(InstallationContext).setTitle

export const useSetInstallationBanner = () => useContext(InstallationContext).setBanner

export const useInstallationIcon = () => useContext(InstallationContext).icon

export const useSetInstallationIcon = () => useContext(InstallationContext).setIcon

export const useInstallationSendsEmail = () => useContext(InstallationContext).sendsEmail

export const useCanResetPassword = (): boolean | undefined => {
  const { sendsEmail, knowsOwnAddress, unreachable } = useContext(InstallationContext)
  if (unreachable === true) return false
  if (sendsEmail === undefined || knowsOwnAddress === undefined) return undefined

  return sendsEmail && knowsOwnAddress
}

export const useSocialLogins = (): readonly OAuthProvider[] =>
  useContext(InstallationContext).socialLogins ?? []

export const useSetInstallationSendsEmail = () => useContext(InstallationContext).setSendsEmail

export const useSetProviderConfigured = () => useContext(InstallationContext).setProviderConfigured
