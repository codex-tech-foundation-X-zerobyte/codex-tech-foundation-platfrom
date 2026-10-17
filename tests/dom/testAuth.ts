import { createContext } from 'react'

/** Lets one test render several providers, each "signed in" as a different user. */
export const TestAuth = createContext<{ profile: { id: string; display_name: string; role: string } | null }>({ profile: null })
