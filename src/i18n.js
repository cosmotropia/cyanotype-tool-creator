// Internationalisation.
//
// The English text in the code is the key (gettext style); every other language is a dictionary in src/locales/.
// Nothing in the UI code needs to know about languages: a MutationObserver translates every text node and the
// title / placeholder / aria-label / alt attributes the moment they appear in the page, and remembers the original
// English so the language can be switched live (no reload) and switched back.
//
// Lookup order for a string: exact match -> pattern (strings with numbers, names or error details) ->
// the same lookup for each part around " · " and " — ". Anything not found stays in English.

import es from './locales/es.js'

export const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Español'],
]
const LOCALES = { en: null, es }
const STORAGE_KEY = 'cyano-lang'

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && saved in LOCALES) return saved
  } catch {
    /* storage unavailable (private mode): fall through to the browser language */
  }
  for (const l of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const code = String(l).slice(0, 2).toLowerCase()
    if (code in LOCALES) return code
  }
  return 'en'
}

let lang = detect()
const listeners = new Set()
const cache = new Map() // `${lang}\n${core}` -> translated core
export const missing = new Set() // English strings that have no translation yet (see window.__i18nMissing)

export const getLang = () => lang

// ---- string lookup ----
const SPLIT = /( · | — )/

function lookup(loc, s) {
  const hit = loc.strings[s]
  if (hit !== undefined) return hit
  for (const [re, fn] of loc.patterns) {
    const m = s.match(re)
    if (m) return fn(m, translate)
  }
  return undefined
}

function translateCore(s) {
  const loc = LOCALES[lang]
  if (!loc) return s
  const key = `${lang}\n${s}`
  if (cache.has(key)) return cache.get(key)
  let out = lookup(loc, s)
  if (out === undefined && SPLIT.test(s)) {
    const parts = s.split(SPLIT)
    let changed = false
    const done = parts.map((p, i) => {
      if (i % 2) return p // the separator
      const r = lookup(loc, p)
      if (r !== undefined) changed = true
      return r ?? p
    })
    if (changed) out = done.join('')
  }
  if (out === undefined) {
    out = s
    if (/[A-Za-z]{3,}/.test(s)) missing.add(s)
  }
  if (cache.size > 4000) cache.clear()
  cache.set(key, out)
  return out
}

/** Translates a string (keeping its leading / trailing spaces). English text in, current language out. */
export function translate(text) {
  if (typeof text !== 'string' || !LOCALES[lang]) return text
  const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/)
  if (!m[2]) return text
  const out = translateCore(m[2])
  return out === m[2] ? text : m[1] + out + m[3]
}
export const t = translate

// ---- DOM translation ----
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt', 'label']
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'])
const textRec = new WeakMap() // text node -> { src, out }
const attrRec = new WeakMap() // element -> { [attr]: { src, out } }

const skipped = (el) => !el || SKIP_TAGS.has(el.tagName?.toUpperCase()) || !!el.closest?.('[translate="no"]')
// What the user types in a textarea is theirs: its placeholder is translated, its content never.
const textSkipped = (el) => skipped(el) || el.tagName === 'TEXTAREA'

function doText(node) {
  if (textSkipped(node.parentElement)) return
  const rec = textRec.get(node)
  const cur = node.nodeValue
  const src = rec && cur === rec.out ? rec.src : cur // unchanged since we wrote it, or new text from the app
  const out = translate(src)
  if (out !== cur) node.nodeValue = out
  textRec.set(node, { src, out })
}

function doAttr(el, name) {
  if (skipped(el) || !el.hasAttribute(name)) return
  const recs = attrRec.get(el) || {}
  const rec = recs[name]
  const cur = el.getAttribute(name)
  const src = rec && cur === rec.out ? rec.src : cur
  const out = translate(src)
  if (out !== cur) el.setAttribute(name, out)
  recs[name] = { src, out }
  attrRec.set(el, recs)
}

function walk(node) {
  if (node.nodeType === Node.TEXT_NODE) return doText(node)
  if (node.nodeType !== Node.ELEMENT_NODE || skipped(node)) return
  for (const a of ATTRS) doAttr(node, a)
  if (node.tagName !== 'TEXTAREA') for (const c of node.childNodes) walk(c)
}

const observer = new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') m.addedNodes.forEach(walk)
    else if (m.type === 'characterData') doText(m.target)
    else if (m.type === 'attributes') doAttr(m.target, m.attributeName)
  }
})

// ---- page-level pieces ----
const TITLE_EN = document.title
const nativeAlert = window.alert.bind(window)
window.alert = (msg) => nativeAlert(translate(String(msg)))

function applyPage() {
  document.documentElement.lang = lang
  document.title = translate(TITLE_EN)
}

export function setLang(next) {
  if (!(next in LOCALES) || next === lang) return
  lang = next
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    /* not persisted, still applies for this visit */
  }
  applyPage()
  walk(document.body)
  listeners.forEach((fn) => fn(lang))
}

/** fn(lang) runs after every language change. Returns an unsubscribe function. */
export function onLangChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

applyPage()
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ATTRS,
})
if (document.body) walk(document.body)

// Handy for debugging / audits: lists the English strings still waiting for a translation.
window.__i18n = { getLang, setLang, missing }
