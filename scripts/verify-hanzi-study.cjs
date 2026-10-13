const fs = require('node:fs')
const vm = require('node:vm')

const dataPath = 'public/hanzi-study/hanzi-data.json'
const writerPath = 'public/hanzi-study/js/lib/dataWriter.js'
const writerExtraPath = 'public/hanzi-study/js/lib/dataWriter1.js'

const entries = JSON.parse(fs.readFileSync(dataPath, 'utf8'))
if (!Array.isArray(entries) || entries.length < 1200) {
  throw new Error(`Expected at least 1200 Hanzi entries, got ${entries.length}`)
}

const ids = new Set()
const characters = new Set()
for (const entry of entries) {
  for (const field of ['id', 'character', 'pinyin', 'word', 'sentence']) {
    if (entry[field] === undefined || entry[field] === null || String(entry[field]).trim() === '') {
      throw new Error(`Invalid Hanzi entry: missing ${field}`)
    }
  }
  if (ids.has(entry.id)) throw new Error(`Duplicate Hanzi id: ${entry.id}`)
  ids.add(entry.id)
  if (characters.has(entry.character)) throw new Error(`Duplicate Hanzi character: ${entry.character}`)
  characters.add(entry.character)
}

const context = { window: {}, timers: [] }
context.setTimeout = (fn) => context.timers.push(fn)
vm.createContext(context)
vm.runInContext(fs.readFileSync(writerPath, 'utf8'), context)
vm.runInContext(fs.readFileSync(writerExtraPath, 'utf8'), context)
context.timers.forEach((fn) => fn())

const writerData = Object.assign({}, context.window.writerData || {}, context.window.writerData1 || {})
const covered = entries.filter((entry) => writerData[entry.character]?.strokes?.length > 0).length
const coverage = covered / entries.length
if (coverage < 0.95) {
  throw new Error(`Offline stroke coverage too low: ${(coverage * 100).toFixed(1)}%`)
}

const expectedStart = '一二三四五六七八九十'
const actualStart = entries.slice(0, expectedStart.length).map((entry) => entry.character).join('')
if (actualStart !== expectedStart) {
  throw new Error(`Unexpected beginner sequence: ${actualStart}`)
}

console.log(
  `Hanzi study verification passed: ${entries.length} characters, ${covered} with offline stroke data (${(coverage * 100).toFixed(1)}%).`,
)
