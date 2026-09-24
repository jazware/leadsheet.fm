import { createContext, useContext } from 'react'

/** Opens the sign-in dialog, optionally saying why. */
export const LoginContext = createContext<(reason?: string) => void>(() => {})
export const useLogin = () => useContext(LoginContext)
