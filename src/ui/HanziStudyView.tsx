import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { audioManager } from '../audio/AudioManager'

interface HanziEntry {
  id: number
  character: string
  pinyin: string
  word: string
  sentence: string
}

interface HanziWriterInstance {
  animateCharacter: () => Promise<unknown> | void
  quiz: (options?: {
    onCorrectStroke?: (data: { strokeNum: number; strokesRemaining: number }) => void
    onComplete?: () => void
  }) => void
  cancelQuiz?: () => void
}

interface HanziWriterApi {
  create: (target: HTMLElement, character: string, options: Record<string, unknown>) => HanziWriterInstance
}

interface WriterCharacterData {
  strokes: string[]
  medians?: number[][][]
  radStrokes?: number[]
}

declare global {
  interface Window {
    HanziWriter?: HanziWriterApi
    writerData?: Record<string, WriterCharacterData>
    writerData1?: Record<string, WriterCharacterData>
  }
}

type PracticeMode = 'learn' | 'listen' | 'write' | 'test'

interface HanziLearningProgress {
  learned?: boolean
  listenCorrect?: number
  writeCompleted?: boolean
  mistakes?: number
  mastered?: boolean
  reviews?: number
}

type HanziProgressMap = Record<string, HanziLearningProgress>

const PAGE_SIZE = 60
const TEST_INTERVAL = 6
const TEST_QUESTIONS = 3
const UNLOCK_KEY = 'xingya-hanzi-unlocked-v1'
const PROGRESS_KEY = 'xingya-hanzi-progress-v2'

function loadScript(src: string, ready: () => boolean) {
  if (ready()) return Promise.resolve()
  const existing = document.querySelector<HTMLScriptElement>(`script[data-xingya-src="${src}"]`)
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
    })
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.dataset.xingyaSrc = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })
}

async function loadWriterAssets() {
  await loadScript('hanzi-study/js/lib/hanzi-writer.min.js', () => Boolean(window.HanziWriter))
  await loadScript('hanzi-study/js/lib/dataWriter.js', () => Boolean(window.writerData))
  await loadScript('hanzi-study/js/lib/dataWriter1.js', () => Boolean(window.writerData1))
  if (window.writerData && window.writerData1) Object.assign(window.writerData, window.writerData1)
}

function shuffle<T>(values: T[]) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function readUnlocked() {
  const value = Number.parseInt(localStorage.getItem(UNLOCK_KEY) ?? '1', 10)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function readProgress(): HanziProgressMap {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? parsed as HanziProgressMap : {}
  } catch {
    return {}
  }
}

export function HanziStudyView({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<HanziEntry[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [page, setPage] = useState(0)
  const [unlocked, setUnlocked] = useState(readUnlocked)
  const [mode, setMode] = useState<PracticeMode>('learn')
  const [feedback, setFeedback] = useState('')
  const [writerReady, setWriterReady] = useState(false)
  const [writeProgress, setWriteProgress] = useState('')
  const [listenOptions, setListenOptions] = useState<HanziEntry[]>([])
  const [testPool, setTestPool] = useState<HanziEntry[]>([])
  const [testTarget, setTestTarget] = useState<HanziEntry | null>(null)
  const [testCorrect, setTestCorrect] = useState(0)
  const [testAsked, setTestAsked] = useState<number[]>([])
  const [progress, setProgress] = useState<HanziProgressMap>(readProgress)
  const progressRef = useRef(progress)
  const writerTargetRef = useRef<HTMLDivElement>(null)
  const writerRef = useRef<HanziWriterInstance | null>(null)
  const effectAudioRef = useRef(new Set<HTMLAudioElement>())

  const current = entries[currentIndex]
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const pageEntries = useMemo(() => entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [entries, page])
  const masteredCount = useMemo(() => entries.filter((entry, index) => index < unlocked - 1 || progress[entry.character]?.mastered).length, [entries, progress, unlocked])
  const reviewCount = useMemo(() => entries.filter((entry) => (progress[entry.character]?.mistakes ?? 0) > 0).length, [entries, progress])
  const currentProgress = current ? progress[current.character] ?? {} : {}
  const legacyMastered = currentIndex < unlocked - 1

  const updateProgress = useCallback((character: string, updater: (previous: HanziLearningProgress) => HanziLearningProgress) => {
    setProgress((previous) => {
      const next = { ...previous, [character]: updater(previous[character] ?? {}) }
      progressRef.current = next
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const speakHanzi = useCallback((text: string, rate = 0.7, pitch = 1) => {
    if (audioManager.isMuted() || audioManager.getVolume() <= 0) {
      setFeedback('当前声音已关闭，请先在主界面打开声音。')
      return false
    }

    if (!Capacitor.isNativePlatform()) {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        setFeedback('当前浏览器不支持语音合成。')
        return false
      }
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = rate
      utterance.pitch = pitch
      utterance.volume = audioManager.getVolume()
      utterance.onerror = (event) => {
        console.warn('Hanzi Web Speech failed.', event.error)
        setFeedback(`语音播放失败：${event.error || 'unknown'}`)
      }
      window.speechSynthesis.speak(utterance)
      return true
    }

    const started = audioManager.speak(text, rate, pitch, 'zh-CN')
    if (!started) setFeedback('语音暂时不可用，请检查系统中文语音设置。')
    return started
  }, [])

  const pickTestTarget = useCallback((pool: HanziEntry[], asked: number[]) => {
    const available = pool.filter((entry) => !asked.includes(entry.id))
    const candidates = available.length > 0 ? available : pool
    const ranked = [...candidates].sort((left, right) => {
      const mistakeGap = (progressRef.current[right.character]?.mistakes ?? 0) - (progressRef.current[left.character]?.mistakes ?? 0)
      return mistakeGap || Math.random() - 0.5
    })
    return ranked[0]
  }, [])

  const startUnitTest = useCallback((pool: HanziEntry[]) => {
    const target = pickTestTarget(pool, [])
    setTestPool(pool)
    setTestCorrect(0)
    setTestAsked(target ? [target.id] : [])
    setTestTarget(target ?? null)
    setMode('test')
    setFeedback('完成 3 道单元小测，就能继续解锁。')
    if (target) window.setTimeout(() => { void speakHanzi(target.character, 0.68, 1.05) }, 200)
  }, [pickTestTarget, speakHanzi])

  const unlockAfterMastery = useCallback(() => {
    if (!current || entries.length === 0) return
    const learnedNumber = currentIndex + 1
    if (currentIndex === unlocked - 1 && learnedNumber % TEST_INTERVAL === 0) {
      startUnitTest(entries.slice(Math.max(0, learnedNumber - TEST_INTERVAL), learnedNumber))
      return
    }
    if (currentIndex === unlocked - 1 && unlocked < entries.length) {
      const nextUnlocked = unlocked + 1
      setUnlocked(nextUnlocked)
      localStorage.setItem(UNLOCK_KEY, String(nextUnlocked))
      setCurrentIndex(currentIndex + 1)
      setMode('learn')
      setFeedback('解锁新汉字啦！先认一认它。')
      return
    }
    if (currentIndex + 1 < unlocked) setCurrentIndex(currentIndex + 1)
    setMode('learn')
  }, [current, currentIndex, entries, startUnitTest, unlocked])

  const playHanziEffect = useCallback((name: 'correct' | 'correct-stroke') => {
    if (audioManager.isMuted() || audioManager.getVolume() <= 0) return
    const audio = new Audio(`hanzi-study/audio/${name}.mp3`)
    audio.volume = audioManager.getVolume()
    effectAudioRef.current.add(audio)
    const cleanup = () => effectAudioRef.current.delete(audio)
    audio.addEventListener('ended', cleanup, { once: true })
    audio.addEventListener('error', cleanup, { once: true })
    void audio.play().catch((error) => {
      cleanup()
      console.warn(`Hanzi effect ${name} could not play.`, error)
    })
  }, [])

  const finishCurrentCharacter = useCallback(() => {
    if (!current) return
    updateProgress(current.character, (previous) => ({
      ...previous,
      learned: true,
      writeCompleted: true,
      mastered: true,
    }))
    playHanziEffect('correct')
    playHanziEffect('correct-stroke')
    setFeedback('这个字学会啦！')
    window.setTimeout(unlockAfterMastery, 900)
  }, [current, playHanziEffect, unlockAfterMastery, updateProgress])

  const startWriterQuiz = useCallback((writer: HanziWriterInstance) => {
    setWriteProgress('从第一笔开始，写错两次会提示哦。')
    writer.quiz({
      onCorrectStroke: (data) => {
        const done = data.strokeNum + 1
        const total = done + data.strokesRemaining
        setWriteProgress(`笔画 ${done}/${total}`)
      },
      onComplete: () => {
        setWriteProgress('写完啦！')
        setFeedback('太棒了，笔顺完成！')
        finishCurrentCharacter()
      },
    })
  }, [finishCurrentCharacter])

  const showStrokeAnimation = useCallback(async () => {
    const writer = writerRef.current
    if (!writer) return
    writer.cancelQuiz?.()
    setWriteProgress('正在演示笔顺…')
    try {
      await Promise.resolve(writer.animateCharacter())
    } finally {
      if (writerRef.current === writer) {
        setFeedback('动画结束，现在可以自己写一遍。')
        startWriterQuiz(writer)
      }
    }
  }, [startWriterQuiz])

  const restartWriterQuiz = useCallback(() => {
    const writer = writerRef.current
    if (!writer) return
    writer.cancelQuiz?.()
    setFeedback('重新开始跟写。')
    startWriterQuiz(writer)
  }, [startWriterQuiz])

  useEffect(() => {
    const activeEffectAudio = effectAudioRef.current
    audioManager.pauseBackgroundMusic()
    return () => {
      activeEffectAudio.forEach((audio) => {
        audio.pause()
        audio.currentTime = 0
      })
      activeEffectAudio.clear()
      audioManager.stop()
      void audioManager.startBackgroundMusic()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void fetch('hanzi-study/hanzi-data.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<HanziEntry[]>
      })
      .then((data) => {
        if (cancelled) return
        setEntries(data)
        setUnlocked((value) => Math.min(Math.max(value, 1), data.length))
      })
      .catch(() => setFeedback('汉字数据加载失败，可使用下方兼容版入口。'))
    void loadWriterAssets()
      .then(() => { if (!cancelled) setWriterReady(true) })
      .catch(() => { if (!cancelled) setFeedback('笔顺资源加载失败，识字和听音仍可使用。') })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (currentIndex < page * PAGE_SIZE || currentIndex >= (page + 1) * PAGE_SIZE) {
      setPage(Math.floor(currentIndex / PAGE_SIZE))
    }
  }, [currentIndex, page])

  useEffect(() => {
    if (!current) return
    setFeedback('')
    setWriteProgress('')
    if (mode === 'listen') {
      const nearby = entries.filter((_, index) => Math.abs(index - currentIndex) <= 18 && index !== currentIndex)
      setListenOptions(shuffle(nearby).slice(0, 3).concat(current).sort(() => Math.random() - 0.5))
      window.setTimeout(() => { void speakHanzi(current.character, 0.68, 1.05) }, 180)
    }
  }, [current, currentIndex, entries, mode, speakHanzi])

  useEffect(() => {
    const writerTarget = writerTargetRef.current
    if (mode !== 'write' || !current || !writerReady || !writerTarget || !window.HanziWriter) return
    writerTarget.innerHTML = ''
    if (!window.writerData?.[current.character]) {
      setWriteProgress('这个汉字暂时没有离线笔顺数据。')
      setFeedback('可以继续使用认识和听音练习。')
      return
    }
    const dataLoader = (character: string, onComplete: (data: WriterCharacterData) => void, onError?: (error: unknown) => void) => {
      const data = window.writerData?.[character]
      if (data) onComplete(data)
      else onError?.(new Error(`No offline stroke data for ${character}`))
    }
    const writer = window.HanziWriter.create(writerTarget, current.character, {
      width: 260,
      height: 260,
      padding: 12,
      showCharacter: false,
      showOutline: true,
      strokeColor: '#31566A',
      outlineColor: '#D8E5EA',
      highlightColor: '#FF9A62',
      drawingColor: '#3F8DE3',
      drawingWidth: 8,
      showHintAfterMisses: 2,
      charDataLoader: dataLoader,
    })
    writerRef.current = writer
    startWriterQuiz(writer)
    return () => {
      writer.cancelQuiz?.()
      writerRef.current = null
      writerTarget.innerHTML = ''
    }
  }, [current, mode, startWriterQuiz, writerReady])

  const speakCurrent = useCallback(() => {
    if (!current) return
    speakHanzi(`${current.character}, ${current.word}的${current.character}`, 0.7, 1)
  }, [current, speakHanzi])

  const finishRecognition = () => {
    if (!current) return
    updateProgress(current.character, (previous) => ({ ...previous, learned: true }))
    setFeedback('认识完成！接下来听声音找汉字。')
    setMode('listen')
  }

  const chooseCharacter = (index: number) => {
    if (index >= unlocked) {
      setFeedback('先学会前面的汉字，就能解锁这里啦。')
      return
    }
    setCurrentIndex(index)
    setMode('learn')
  }

  const answerListen = (entry: HanziEntry) => {
    if (!current) return
    if (entry.id === current.id) {
      updateProgress(current.character, (previous) => ({
        ...previous,
        learned: true,
        listenCorrect: (previous.listenCorrect ?? 0) + 1,
      }))
      setFeedback('答对啦！接下来按笔顺写一写。')
      void speakHanzi('答对啦', 0.82, 1.12)
      window.setTimeout(() => setMode('write'), 420)
    } else {
      updateProgress(current.character, (previous) => ({ ...previous, mistakes: (previous.mistakes ?? 0) + 1 }))
      setFeedback('再听一次试试看。')
      void speakHanzi(current.character, 0.65, 1.05)
    }
  }

  const nextTestQuestion = (pool: HanziEntry[], asked: number[]) => {
    const target = pickTestTarget(pool, asked)
    if (!target) return
    setTestTarget(target)
    setTestAsked((previous) => previous.includes(target.id) ? previous : [...previous, target.id])
    window.setTimeout(() => { void speakHanzi(target.character, 0.65, 1.05) }, 180)
  }

  const answerTest = (entry: HanziEntry) => {
    if (!testTarget) return
    if (entry.id !== testTarget.id) {
      updateProgress(testTarget.character, (previous) => ({ ...previous, mistakes: (previous.mistakes ?? 0) + 1 }))
      setFeedback('再听一次。')
      void speakHanzi(testTarget.character, 0.65, 1.05)
      return
    }
    const correct = testCorrect + 1
    updateProgress(testTarget.character, (previous) => ({
      ...previous,
      reviews: (previous.reviews ?? 0) + 1,
      mistakes: Math.max(0, (previous.mistakes ?? 0) - 1),
    }))
    if (correct >= TEST_QUESTIONS) {
      const nextUnlocked = Math.min(entries.length, unlocked + 1)
      setUnlocked(nextUnlocked)
      localStorage.setItem(UNLOCK_KEY, String(nextUnlocked))
      setMode('learn')
      setTestCorrect(0)
      setTestAsked([])
      setCurrentIndex(Math.min(currentIndex + 1, entries.length - 1))
      setFeedback('单元小测通过！新汉字已解锁。')
      void speakHanzi('太棒了，小测通过', 0.8, 1.12)
      return
    }
    setTestCorrect(correct)
    setFeedback(`答对 ${correct}/${TEST_QUESTIONS}，继续！`)
    nextTestQuestion(testPool, testAsked)
  }

  const testOptions = useMemo(() => {
    if (!testTarget || testPool.length === 0) return []
    return shuffle(testPool.filter((item) => item.id !== testTarget.id)).slice(0, 3).concat(testTarget).sort(() => Math.random() - 0.5)
  }, [testPool, testTarget])

  return (
    <div className="hanzi-study-overlay">
      <div className="hanzi-study-shell">
        <header className="hanzi-study-header">
          <button className="hanzi-icon-button" onClick={onClose}>← 学习馆</button>
          <div><h1>汉字小屋</h1><p>认一认 · 听一听 · 写一写</p></div>
          <div className="hanzi-progress-pill">掌握 {masteredCount} · 解锁 {Math.min(unlocked, entries.length || unlocked)} / {entries.length || '…'}{reviewCount > 0 ? ` · 待复习 ${reviewCount}` : ''}</div>
        </header>

        <main className="hanzi-study-main">
          <section className="hanzi-grid-panel">
            <div className="hanzi-grid-toolbar"><strong>汉字星图</strong><span>第 {page + 1}/{totalPages} 页</span></div>
            <div className="hanzi-grid">
              {pageEntries.map((entry, localIndex) => {
                const index = page * PAGE_SIZE + localIndex
                const locked = index >= unlocked
                const itemProgress = progress[entry.character]
                const mastered = index < unlocked - 1 || itemProgress?.mastered
                const needsReview = (itemProgress?.mistakes ?? 0) > 0
                return (
                  <button key={entry.id} className={`hanzi-grid-item${index === currentIndex ? ' selected' : ''}${locked ? ' locked' : ''}${mastered ? ' mastered' : ''}${needsReview ? ' needs-review' : ''}`} onClick={() => chooseCharacter(index)}>
                    <span>{entry.character}</span>{locked ? <small>🔒</small> : mastered ? <small>★</small> : needsReview ? <small>●</small> : null}
                  </button>
                )
              })}
            </div>
            <div className="hanzi-page-controls">
              <button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>上一页</button>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>下一页</button>
            </div>
          </section>

          <section className="hanzi-learning-panel">
            {current ? (
              <>
                <nav className="hanzi-mode-tabs">
                  <button className={mode === 'learn' ? 'active' : ''} onClick={() => setMode('learn')}>认识{legacyMastered || currentProgress.learned ? ' ✓' : ''}</button>
                  <button disabled={!legacyMastered && !currentProgress.learned} className={mode === 'listen' ? 'active' : ''} onClick={() => setMode('listen')}>听音{legacyMastered || (currentProgress.listenCorrect ?? 0) > 0 ? ' ✓' : ''}</button>
                  <button disabled={!legacyMastered && (currentProgress.listenCorrect ?? 0) < 1} className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')}>笔顺跟写{legacyMastered || currentProgress.writeCompleted ? ' ✓' : ''}</button>
                </nav>
                {mode === 'learn' && (
                  <div className="hanzi-card-view">
                    <button className="hanzi-big-character" onClick={speakCurrent}>{current.character}</button>
                    <div className="hanzi-pinyin">{current.pinyin}</div>
                    <div className="hanzi-word"><span>组词</span>{current.word}</div>
                    <div className="hanzi-sentence"><span>例句</span>{current.sentence}</div>
                    <button className="hanzi-primary-button" onClick={speakCurrent}>🔊 听发音和例句</button>
                    {!legacyMastered && !currentProgress.mastered && <button className="hanzi-stage-button" onClick={finishRecognition}>我认识了，去听音 →</button>}
                  </div>
                )}
                {mode === 'listen' && (
                  <div className="hanzi-practice-view">
                    <h2>听声音，找到正确的汉字</h2>
                    <button className="hanzi-listen-button" onClick={() => void speakHanzi(current.character, 0.65, 1.05)}>🔊 再听一次</button>
                    <div className="hanzi-choice-grid">{listenOptions.map((entry) => <button key={entry.id} onClick={() => answerListen(entry)}>{entry.character}</button>)}</div>
                  </div>
                )}
                {mode === 'write' && (
                  <div className="hanzi-practice-view hanzi-write-view">
                    <h2>按笔顺写一写「{current.character}」</h2>
                    {writerReady ? <div className="hanzi-writer-target" ref={writerTargetRef} /> : <p>正在准备离线笔顺资源…</p>}
                    <div className="hanzi-write-status">{writeProgress || '从第一笔开始，写错两次会提示哦。'}</div>
                    <div className="hanzi-write-actions">
                      <button className="hanzi-secondary-button" onClick={() => void showStrokeAnimation()}>▶ 看笔顺动画</button>
                      <button className="hanzi-secondary-button" onClick={restartWriterQuiz}>✍ 重新跟写</button>
                    </div>
                    {writerReady && !window.writerData?.[current.character] && <button className="hanzi-stage-button" onClick={finishCurrentCharacter}>这个字暂无笔顺，完成学习 →</button>}
                  </div>
                )}
                {mode === 'test' && testTarget && (
                  <div className="hanzi-practice-view">
                    <div className="hanzi-test-badge">单元小测 {testCorrect + 1}/{TEST_QUESTIONS}</div>
                    <h2>听声音，选出学过的汉字</h2>
                    <button className="hanzi-listen-button" onClick={() => void speakHanzi(testTarget.character, 0.65, 1.05)}>🔊 再听一次</button>
                    <div className="hanzi-choice-grid">{testOptions.map((entry) => <button key={entry.id} onClick={() => answerTest(entry)}>{entry.character}</button>)}</div>
                  </div>
                )}
                <div className="hanzi-feedback" aria-live="polite">{feedback}</div>
                {mode !== 'test' && (
                  <div className="hanzi-navigation">
                    <button disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => Math.max(0, value - 1))}>← 上一个</button>
                    <span className="hanzi-stage-hint">{legacyMastered || currentProgress.mastered ? '已掌握' : mode === 'learn' ? '先认识，再完成听音和跟写' : mode === 'listen' ? '答对后进入跟写' : '写完后自动解锁'}</span>
                    <button disabled={currentIndex + 1 >= unlocked} onClick={() => setCurrentIndex((value) => Math.min(unlocked - 1, value + 1))}>下一个 →</button>
                  </div>
                )}
              </>
            ) : <div className="hanzi-loading">正在打开汉字小屋…</div>}
          </section>
        </main>

        <footer className="hanzi-study-footer">
          <span>内容来自本地离线题库，学习进度只保存在当前设备。</span>
          <button onClick={() => window.location.assign('hanzi-study/index.html')}>打开兼容版</button>
        </footer>
      </div>
    </div>
  )
}
