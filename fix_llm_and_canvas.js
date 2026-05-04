const fs = require('fs');

let html = fs.readFileSync('Component.NewJournal.html', 'utf8');

// 1. Fix the LLM Input / Output Log
const nlpLogHtml = `                            <!-- NLP Event Log -->
                            <div id="nlp-event-log"
                                style="position: absolute; top: 100%; left: 30px; margin-top: 6px; font-size: 11px; color: rgba(255,255,255,0.8); font-family: monospace; white-space: nowrap; pointer-events: none; text-shadow: 0 1px 2px rgba(0,0,0,0.8);">
                            </div>`;

if (!html.includes('id="nlp-event-log"')) {
    html = html.replace('<!-- PARSER FEEDBACK ROW (1-line output) -->', nlpLogHtml + '\n\n                            <!-- PARSER FEEDBACK ROW (1-line output) -->');
}

// 2. Fix the LLM submit function
const oldSubmitLogbookChat = `function submitLogbookChat() {
            const inputEl = document.getElementById('llm-input');
            const val = inputEl.value.trim();
            if (!val) return;

            // Intercept close/exit commands locally
            const cmd = val.toLowerCase();
            const closeCommands = ['close', 'exit', 'exit journal', 'close journal', 'close book', 'exit book', 'quit', 'bye'];
            if (closeCommands.includes(cmd)) {
                inputEl.value = ''; inputEl.blur();
                if (window.initiateCloseSequence) window.initiateCloseSequence();
                return;
            }

            // Forward everything else to the engine (using window.top because we are inside a nested iframe)
            try { window.top.postMessage({ type: 'PROCESS_INPUT', value: val }, '*'); } catch (e) { }
            inputEl.value = ''; inputEl.blur();
            const announcer = document.getElementById('sr-announcer');
            if (announcer) announcer.textContent = "Command submitted.";
        }`;

// Replace the entire submitLogbookChat logic
const submitRegex = /\/\* PRE-PARSER & SUBMISSION \*\/[\s\S]*?const announcer = document\.getElementById\('sr-announcer'\);\s*if \(announcer\) announcer\.textContent = feedbackEl\.textContent;\s*\}/m;
html = html.replace(submitRegex, oldSubmitLogbookChat);

// 3. Fix the Output Canvas Field (PIP viewfinder)
const pipBoxRegex = /if \(block\.type === 'pip-box'\) {\s*return ''; \/\/ TIPI CAM REMOVED per user request\s*}/;
const pipBoxReplacement = `if (block.type === 'pip-box') {
                    return \`
                        <div class="w-full flex justify-center mt-2 mb-3">
                            <div onclick="if(window.parent.emit) window.parent.emit('TOGGLE_VIEW_MODE');" data-pip-target="tipi" class="cursor-pointer hover:scale-105 transition-transform rounded-full shadow-[inset_0_4px_10px_rgba(0,0,0,0.6),0_4px_15px_rgba(28,16,11,0.4)] border-4 border-[#1c100b] w-[45px] h-[45px] md:w-[60px] md:h-[60px] bg-transparent relative overflow-hidden flex items-center justify-center">
                            </div>
                        </div>
                    \`;
                }`;

html = html.replace(pipBoxRegex, pipBoxReplacement);

fs.writeFileSync('Component.NewJournal.html', html);
console.log('Fixed LLM and Output Canvas.');
