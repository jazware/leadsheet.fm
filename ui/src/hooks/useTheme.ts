import { useEffect } from 'react'
import { usePref } from '@/hooks/usePref'

export type Theme = 'night' | 'day'

/** Night by default; day is a per-browser toggle. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = usePref<Theme>('theme', 'night')
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'day') root.dataset.theme = 'day'
    else delete root.dataset.theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'day' ? '#F6F8FC' : '#0F1626')
  }, [theme])
  return [theme, () => setTheme(theme === 'day' ? 'night' : 'day')]
}
