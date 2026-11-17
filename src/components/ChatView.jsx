import { useEffect, useRef, useState } from 'react';
import { Clock, ChevronRight } from 'lucide-react';
import ProcessSheet, { fmtDur } from './ProcessSheet';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Link file:// (path lokal server) nggak bisa dibuka di HP -> tampilkan sebagai teks biasa
const mdComponents = {
  a: ({ href = '', children }) =>
    /^https?:\/\//i.test(href)
      ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      : <span className="md-filelink">{children}</span>,
  table: ({ children }) => <div className="md-table-wrap"><table>{children}</table></div>,
};

function Markdown({ text }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{text}</ReactMarkdown>;
}

// Baris ringkas di atas jawaban AI: "🕒 <status/langkah terakhir> >" — tap untuk buka Ringkasan
function ProcessRow({ m, onOpen }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!m.streaming) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [m.streaming]);

  const tools = (m.steps || []).filter(s => s.kind !== 'think');
  let label;
  if (m.streaming) {
    const secs = m.startedAt ? Math.round((now - m.startedAt) / 1000) : 0;
    label = `${m.status || 'Berpikir…'} ${secs ? '· ' + secs + ' dtk' : ''}`;
  } else {
    const last = tools[tools.length - 1];
    label = last ? `${last.label}${tools.length > 1 ? ` (+${tools.length - 1} langkah)` : ''}`
      : `Berpikir${m.durationSec != null ? ' selama ' + fmtDur(m.durationSec) : ''}`;
  }
  return (
    <button className={'proc-row' + (m.streaming ? ' live' : '')} onClick={onOpen}>
      <Clock size={16} className={m.streaming ? 'spin-slow' : ''} />
      <span className={'proc-row-text' + (m.streaming ? ' shimmer' : '')}>{label}</span>
      <ChevronRight size={16} />
    </button>
  );
}

export default function ChatView({ messages }) {
  const endRef = useRef(null);
  const [openIdx, setOpenIdx] = useState(null);

  useEffect(() => {
    // Scroll HANYA container chat (bukan seluruh halaman)
    const box = endRef.current?.closest('.content');
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
    if (window.scrollY) window.scrollTo(0, 0);
  }, [messages]);

  return (
    <div className="chat-view">
      {messages.map((m, i) => (
        <div key={i} className={'msg ' + (m.role === 'user' ? 'msg-user' : 'msg-ai')}>
          {m.attachments?.length > 0 && (
            <div className="attach-row">
              {m.attachments.map((f, j) => <span key={j} className="chip">{f.name}</span>)}
            </div>
          )}
          {m.role === 'assistant' && m.steps && <ProcessRow m={m} onOpen={() => setOpenIdx(i)} />}
          {(m.content || m.role === 'user') && (
            m.role === 'user'
              ? <div className="bubble">{m.content}</div>
              : <div className="bubble md"><Markdown text={m.content} />{m.streaming && m.content ? <span className="caret" /> : null}</div>
          )}
        </div>
      ))}
      <div ref={endRef} />
      <ProcessSheet open={openIdx != null} msg={openIdx != null ? messages[openIdx] : null} onClose={() => setOpenIdx(null)} />
    </div>
  );
}
