import { useEffect, useState } from 'react'
import { GameContainer } from './ui/GameContainer'
import { HanziStudyView } from './ui/HanziStudyView'

export default function App() {
  const [hanziOpen, setHanziOpen] = useState(false)

  useEffect(() => {
    const openHanzi = () => setHanziOpen(true)
    window.addEventListener('xingya:open-hanzi', openHanzi)
    return () => window.removeEventListener('xingya:open-hanzi', openHanzi)
  }, [])

  const closeHanzi = () => {
    setHanziOpen(false)
    window.dispatchEvent(new CustomEvent('xingya:close-hanzi'))
  }

  return (
    <>
      <GameContainer />
      {hanziOpen && <HanziStudyView onClose={closeHanzi} />}
    </>
  )
}
