import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AssistantChart } from './AssistantChart';
import { AssistantDisplay, DISPLAY_LANGS } from './AssistantDisplay';
import { remarkLinkifyEntities } from './remarkLinkifyEntities';

/**
 * Renders an assistant answer as GitHub-flavored Markdown, intercepting fenced
 * ```chart and ```map blocks and rendering them as inline SVG charts / Leaflet
 * maps. A remark plugin also auto-links bare aviation entities (ICAO hex,
 * callsigns, tail numbers) to the app's detail screen.
 *
 * Viz blocks ride inside the markdown so streaming and non-streaming answers
 * render identically. While a block is still streaming its JSON is incomplete —
 * we swallow the parse error and show a lightweight placeholder until it closes.
 */

const REMARK_PLUGINS = [remarkGfm, remarkLinkifyEntities];

const flattenText = (node) => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (React.isValidElement(node)) return flattenText(node.props?.children);
  return '';
};

// Fenced languages we intercept and render as viz instead of a code block.
// `chart` → SVG chart; `stats|timeline|compare|callout` → rich breakdown blocks;
// `map` → suppressed (maps render from the live_aircraft_map / recent_pireps tool
// call with exact coordinates — a model-authored ```map block rounds/invents
// coords and lands the map in the wrong place).
const VIZ_LANGS = new RegExp(`(?:^|\\s)language-(chart|map|${DISPLAY_LANGS.join('|')})(?:\\s|$)`);

const vizLang = (child) => {
  if (!React.isValidElement(child)) return null;
  const m = VIZ_LANGS.exec(child.props?.className || '');
  return m ? m[1] : null;
};

function VizBlock({ lang, raw }) {
  if (lang === 'map') return null; // maps come from the tool event, not markdown
  let spec = null;
  try {
    spec = JSON.parse(raw.trim());
  } catch {
    return <div className="v2-asst-chart__pending">rendering {lang}…</div>;
  }
  if (lang === 'chart') return <AssistantChart spec={spec} />;
  return <AssistantDisplay lang={lang} spec={spec} />;
}

const COMPONENTS = {
  // Fenced code blocks arrive as <pre><code class="language-*">. Intercept the
  // chart/map languages here so we can replace the whole <pre> with the viz.
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    const lang = vizLang(child);
    if (lang) {
      return <VizBlock lang={lang} raw={flattenText(child.props?.children)} />;
    }
    return <pre className="v2-asst-md__pre">{children}</pre>;
  },
  a({ href, children }) {
    return (
      <a href={href} target={href?.startsWith('#') ? undefined : '_blank'} rel="noreferrer">
        {children}
      </a>
    );
  },
  // Airframe photos are rendered from the fetch_airframe_photo tool call with a
  // server-templated src (see AssistantThread / useAssistantChat), NOT from the
  // model's markdown. Suppress any markdown image the model emits so a
  // hallucinated URL (e.g. a made-up sky-spy.com / s3 host) can never render.
  img() {
    return null;
  },
};

export function AssistantMarkdown({ text }) {
  return (
    <div className="v2-asst-md">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text || ''}
      </ReactMarkdown>
    </div>
  );
}

export default AssistantMarkdown;
