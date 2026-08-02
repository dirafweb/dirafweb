/**
 * Regenera la sección "Ahora mismo · Currently" del README a partir de la
 * actividad pública real de GitHub, resumida por OpenAI.
 *
 * No inventa: solo se le pasan al modelo repos que realmente recibieron push,
 * con su descripción y lenguaje. Si algo falla, el README se deja intacto.
 *
 * Variables de entorno:
 *   OPENAI_API_KEY  (requerida)  secreto del repo
 *   GITHUB_TOKEN    (requerida)  lo inyecta Actions
 *   GH_USER         (opcional)   por defecto: dirafweb
 *   OPENAI_MODEL    (opcional)   por defecto: gpt-4o-mini
 */

import { readFile, writeFile } from 'node:fs/promises'

const USER = process.env.GH_USER || 'dirafweb'
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const README = 'README.md'
const START = '<!-- AHORA-MISMO:START -->'
const END = '<!-- AHORA-MISMO:END -->'

const fail = (msg) => {
  console.error(`[ahora-mismo] ${msg} — README sin cambios.`)
  process.exit(0) // salida limpia: nunca romper el workflow por esto
}

/** Repos propios (no forks) con push en los últimos 60 días. */
async function actividadReciente() {
  const res = await fetch(
    `https://api.github.com/users/${USER}/repos?sort=pushed&per_page=30&type=owner`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      },
    },
  )
  if (!res.ok) fail(`GitHub API respondió ${res.status}`)

  const corte = Date.now() - 60 * 24 * 60 * 60 * 1000
  return (await res.json())
    .filter((r) => !r.fork && !r.archived && new Date(r.pushed_at).getTime() > corte)
    .slice(0, 6)
    .map((r) => ({
      nombre: r.name,
      descripcion: r.description || '(sin descripción)',
      lenguaje: r.language || 'n/a',
      ultimoPush: r.pushed_at.slice(0, 10),
    }))
}

async function redactar(repos) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 160,
      messages: [
        {
          role: 'system',
          content: [
            'Escribes la sección "Ahora mismo" del README de perfil de Farid Jiménez,',
            'AI Engineer y fundador de Xentris Tech.',
            'Reglas estrictas:',
            '- Máximo 2 frases, en español, tono sobrio y profesional.',
            '- Usa ÚNICAMENTE los repositorios que te doy. No inventes proyectos,',
            '  tecnologías, métricas ni logros.',
            '- Enlaza cada repo mencionado en markdown a https://github.com/' + USER + '/<nombre>.',
            '- Sin emojis, sin superlativos, sin "emocionado de anunciar".',
            '- Devuelve solo el texto final, sin encabezados ni comillas.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `Repos con actividad reciente:\n${JSON.stringify(repos, null, 2)}`,
        },
      ],
    }),
  })

  if (!res.ok) fail(`OpenAI respondió ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const texto = (await res.json()).choices?.[0]?.message?.content?.trim()
  return texto || fail('OpenAI devolvió texto vacío')
}

const repos = await actividadReciente()
if (repos.length === 0) fail('Sin actividad reciente en repos propios')

const texto = await redactar(repos)
const md = await readFile(README, 'utf8')
const i = md.indexOf(START)
const j = md.indexOf(END)
if (i === -1 || j === -1) fail('No encontré los marcadores AHORA-MISMO en el README')

const actualizado = md.slice(0, i + START.length) + '\n' + texto + '\n' + md.slice(j)
if (actualizado === md) {
  console.log('[ahora-mismo] Sin cambios.')
  process.exit(0)
}

await writeFile(README, actualizado)
console.log(`[ahora-mismo] Actualizado desde ${repos.length} repos:\n${texto}`)
