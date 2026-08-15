import { renderMarkdown } from '../markdown.ts'

const EXAMPLES: readonly { what: string; source: string }[] = [
  { what: 'Emphasis', source: '**bold**, *italic*' },
  { what: 'A heading', source: '## Saturday' },
  { what: 'A list', source: '- towels\n- a mug\n- something warm' },
  { what: 'A numbered list', source: '1. arrive\n2. hug\n3. build' },
  { what: 'A link', source: '[the burn directory](https://the.burn.directory/)' },
  { what: 'A quote', source: '> what somebody else said' },
  { what: 'Code', source: 'the file is `docker-compose.yml`' },
  { what: 'A line between things', source: 'before\n\n---\n\nafter' },
]

const NAMING = 'Ask @Somebody — the box offers names after an @, and picks the person, not the text.'

const RAW_HTML = 'Raw HTML like <b>this</b> is shown as you typed it, never as formatting.'

const Example = ({ what, source }: { what: string; source: string }) => (
  <tr>
    <th scope="row">{what}</th>
    <td>
      <pre class="formatting-source">{source}</pre>
    </td>
    <td>
      {/* `renderMarkdown` escapes raw HTML rather than filtering it, which is what makes this safe. */}
      <div class="markdown-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />
    </td>
  </tr>
)

export const Formatting = () => (
  <section class="page prose">
    <h1>Formatting</h1>

    <p>
      Every longer box in the app — a dream's description, an announcement, a comment, a food idea, what a
      role is for — takes <strong>markdown</strong>: plain text with a few marks in it. The{' '}
      <strong>Preview</strong> tab over the box shows what it will look like before anybody else sees it.
    </p>

    <div class="table-wrap">
      <table class="formatting-table">
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">What you type</th>
            <th scope="col">How it reads</th>
          </tr>
        </thead>
        <tbody>
          {EXAMPLES.map((one) => (
            <Example key={one.what} what={one.what} source={one.source} />
          ))}
        </tbody>
      </table>
    </div>

    <h2>Pictures</h2>

    <p>
      Where a box has the 🖼 button you can also paste a picture straight in, or drop one on the box. It is
      uploaded and left in the text as <code>![](…)</code>, which you can move or delete like any other words.
      A picture from elsewhere on the web works too, as long as its address starts with <code>https://</code>.
    </p>

    <h2>Naming somebody</h2>

    <p>{NAMING}</p>

    <p>
      <code>@everybody</code> names everyone coming to the burn — or everyone here, on something that belongs
      to no burn. Whoever is named is told once, and told that they were named rather than that a comment
      happened.
    </p>

    <h2>What is not formatting</h2>

    <p>{RAW_HTML}</p>

    <p>
      Links are only followed where they start with <code>https://</code>, <code>http://</code> or{' '}
      <code>mailto:</code>, or point at a page of this app. Anything else is left as the words you typed —
      which is what stops a link doing something you did not mean.
    </p>
  </section>
)
