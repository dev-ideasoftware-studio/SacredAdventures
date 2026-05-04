const fs = require('fs');
const html = fs.readFileSync('Component.NewJournal.html', 'utf8');
const regex = /window\.LOGBOOK_DATA = {[\s\S]*?JournalMasterAI\.initializeDatabase\(\);\s*}\);/m;

const replacement = `window.LOGBOOK_DATA = {
            log: [
                {
                    pageId: 1,
                    title: "Welcome",
                    icon: "fa-solid fa-gamepad",
                    contentBlocks: [
                        { type: "html-box", html: \`
                            <div class="float-right w-[45%] max-w-[200px] ml-3 mb-2">
                                <video muted playsinline autoplay preload="auto" class="rounded-md shadow-md w-full aspect-[4/3] object-cover cursor-pointer border border-[#1c100b]/20"
                                    onended="this.pause();" onclick="if(this.paused){this.currentTime=0; this.play();}else{this.pause();}">
                                    <source src="./Assets/AnimatedOpening.mp4" type="video/mp4">
                                </video>
                            </div>
                            <p class="book-text"><span class="drop-cap" aria-hidden="true">W</span><span class="sr-only">W</span>elcome to Sacred Adventures!</p>
                            <br>
                            <p class="book-text">This game is connected to a real-world charity project to build the same buildings you will -- in the real world. This is a digital twin game, so the more you play, the more interest we get to help build our real Sioux Indian Village!</p>
                            <br>
                            <p class="book-text text-center italic font-bold text-[#6d4c41] drop-shadow-sm mt-2 clear-both">Thanks for playing!</p>
                        \` }
                    ]
                },
                {
                    pageId: 2,
                    title: "Introduction to the PIP",
                    icon: "fa-solid fa-map",
                    contentBlocks: [
                        { type: "pip-box" },
                        { type: "text-box", text: "Click the live viewfinder above to enter the Village View and start building. Click the button below to start playing." }
                    ],
                    button: { label: "Start Game", action: "window.parent.postMessage({ type: 'REQ_AUTOWALK_TO_ENTITY', targetName: 'yellowbutterfly' }, '*'); setTimeout(() => { window.parent.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*'); }, 300);" }
                }
            ],
            quests: [
                {
                    pageId: 1,
                    title: "The Beginning",
                    contentBlocks: [
                        { type: "text-box", text: "Your journey starts here. Explore the world and discover your first quest." }
                    ],
                    button: { label: "Start Game", action: "window.parent.postMessage({ type: 'REQ_TOGGLE_LOGBOOK' }, '*');" }
                }
            ],
            bestiary: [
                {
                    pageId: 1,
                    title: "Wild Fox",
                    contentBlocks: [
                        { type: "image-box", url: "./Assets/Journal.Cover.png" },
                        { type: "text-box", text: "A fast, clever creature often found near the forest edges." }
                    ]
                }
            ]
        };

        const JournalMasterAI = {
            renderBox: (block) => {
                if (block.type === 'text-box') {
                    let text = block.text;
                    if (text.length > 0) {
                        text = \`<span class="drop-cap" aria-hidden="true">\${text.charAt(0)}</span><span class="sr-only">\${text.charAt(0)}</span>\${text.slice(1)}\`;
                    }
                    return \`<div class="book-text"><p>\${text}</p></div>\`;
                }
                if (block.type === 'html-box') {
                    return \`<div class="w-full text-left">\${block.html}</div>\`;
                }
                if (block.type === 'pip-box') {
                    return ''; // TIPI CAM REMOVED per user request
                }
                if (block.type === 'image-box') {
                    return \`
                        <div class="w-full flex justify-center mt-2 mb-3">
                            <img src="\${block.url}" class="rounded-md shadow-md max-w-[80%] max-h-[140px] border border-[#1c100b]/20" alt="Illustration">
                        </div>
                    \`;
                }
                if (block.type === 'video-box') {
                    const vidSrc = window.parent && window.parent._cachedVideoBlobUrl ? window.parent._cachedVideoBlobUrl : block.url;
                    return \`
                        <div class="w-full flex justify-center mt-2 mb-3">
                            <video muted playsinline autoplay preload="auto" class="rounded-md shadow-md max-w-[80%] max-h-[140px] cursor-pointer border border-[#1c100b]/20"
                                onended="this.pause();" onclick="if(this.paused){this.currentTime=0; this.play();}else{this.pause();}">
                                <source src="\${vidSrc}" type="video/mp4">
                            </video>
                        </div>
                    \`;
                }
                return '';
            },

            compilePage: (pageData) => {
                let html = '';
                if (pageData.contentBlocks) {
                    pageData.contentBlocks.forEach(block => {
                        html += JournalMasterAI.renderBox(block);
                    });
                }
                return html;
            },

            initializeDatabase: () => {
                game.content = { log: [], quests: [], bestiary: [] };
                Object.keys(window.LOGBOOK_DATA).forEach(category => {
                    window.LOGBOOK_DATA[category].forEach(page => {
                        const compiledHTML = JournalMasterAI.compilePage(page);
                        window.addPage(
                            category, page.title, compiledHTML, page.state || null, null, null,
                            page.button ? page.button.label : null, page.button ? page.button.action : null
                        );
                    });
                });
                window.switchBookTab('log');
                if (typeof window.update3DPages === 'function') window.update3DPages();
            }
        };

        window.addEventListener('DOMContentLoaded', () => {
            JournalMasterAI.initializeDatabase();
        });`;

const updatedHtml = html.replace(regex, replacement);
fs.writeFileSync('Component.NewJournal.html', updatedHtml);
console.log('Fixed and saved Component.NewJournal.html successfully.');
