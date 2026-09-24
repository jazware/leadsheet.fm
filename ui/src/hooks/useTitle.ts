import { useEffect } from 'react'

/** Sets the tab title while a page is shown ("… | Leadsheet"). */
export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} | Leadsheet` : 'Leadsheet'
    return () => {
      document.title = 'Leadsheet'
    }
  }, [title])
}
