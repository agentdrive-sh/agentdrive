import { INSTALL_COMMAND } from '@/app/integrations/data';

// Inline and ES5 on purpose: agents and scanners look for tools at page load, before the
// React bundle hydrates. The API is still moving, so it takes the W3C registerTool form
// first, falls back to Chrome's earlier provideContext, and retries in case it arrives late.
export const WEBMCP_SCRIPT = `(function () {
  var text = function (v) { return { content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] }; };
  var tools = [
    {
      name: 'search_docs',
      description: 'Search the AgentDrive documentation. Returns up to 5 matches with their URLs.',
      inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' } }, required: ['query'] },
      execute: function (input) {
        var q = encodeURIComponent(String((input && input.query) || ''));
        return fetch('/api/search?query=' + q, { credentials: 'omit' })
          .then(function (r) { return r.json(); })
          .then(function (hits) {
            return text(hits.slice(0, 5).map(function (h) {
              return { content: String(h.content).replace(/<\\/?mark>/g, ''), url: new URL(h.url, location.origin).href };
            }));
          });
      }
    },
    {
      name: 'get_install_command',
      description: 'Get the shell command that installs AgentDrive and connects it to your agent tools.',
      inputSchema: { type: 'object', properties: {} },
      execute: function () { return Promise.resolve(text(${JSON.stringify(INSTALL_COMMAND)})); }
    }
  ];
  var done = false;
  function register() {
    if (done) return true;
    var mc = document.modelContext || navigator.modelContext;
    if (!mc) return false;
    done = true;
    try {
      if (mc.registerTool) {
        tools.forEach(function (t) { Promise.resolve(mc.registerTool(t)).catch(function () {}); });
      } else if (mc.provideContext) {
        mc.provideContext({ tools: tools });
      }
    } catch (e) {}
    return true;
  }
  if (register()) return;
  var tries = 0;
  var timer = setInterval(function () { if (register() || ++tries >= 60) clearInterval(timer); }, 250);
  addEventListener('DOMContentLoaded', register);
  addEventListener('load', register);
})();`;
