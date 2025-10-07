// ==UserScript==
// @name         Lichess AI Coach v1.19
// @namespace    http://tampermonkey.net/
// @version      1.19
// @description  Full AI Coach: per-move, full review, AI request, config, persistent open/close state, draggable window (+refresh buttons styled) + window position
// @match        https://lichess.org/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    //////////////////////
    // CONFIG + CACHE
    //////////////////////
    function loadConfig() {
        return {
            delay: parseInt(localStorage.getItem("lichessTools-delay") || "2000"),
            analysisLevel: localStorage.getItem("lichessTools-analysisLevel") || "medium",
            apiUrl: localStorage.getItem("lichessTools-apiUrl") || "http://localhost:1234/v1/chat/completions",
            model: localStorage.getItem("lichessTools-model") || "LM Studio Community/Meta-Llama-3-8B-Instruct-GGUF",
            temperature: parseFloat(localStorage.getItem("lichessTools-temperature") || "0.7"),
            maxTokens: parseInt(localStorage.getItem("lichessTools-maxTokens") || "500"),
            showAIRequest: localStorage.getItem("lichessTools-showAIRequest") !== "false",
            windowPosition: localStorage.getItem("lichessTools-windowPosition") || "left-bottom"
        };
    }

    function saveConfig(cfg) {
        localStorage.setItem("lichessTools-delay", cfg.delay);
        localStorage.setItem("lichessTools-analysisLevel", cfg.analysisLevel);
        localStorage.setItem("lichessTools-apiUrl", cfg.apiUrl);
        localStorage.setItem("lichessTools-model", cfg.model);
        localStorage.setItem("lichessTools-temperature", cfg.temperature);
        localStorage.setItem("lichessTools-maxTokens", cfg.maxTokens);
        localStorage.setItem("lichessTools-showAIRequest", cfg.showAIRequest);
        localStorage.setItem("lichessTools-windowPosition", cfg.windowPosition);
    }

    function getCache() { return JSON.parse(localStorage.getItem("lichessTools-cache")||"{}"); }
    function setCache(cache) { localStorage.setItem("lichessTools-cache", JSON.stringify(cache)); }
    function isCoachClosed() { return localStorage.getItem("lichessTools-coach-closed")==="true"; }
    function setCoachClosed(state) { localStorage.setItem("lichessTools-coach-closed", state?"true":"false"); }
    function getGameId(){ const match=window.location.href.match(/lichess.org\/([A-Za-z0-9]+)(?:#\d+)?/); return match?match[1]:"unknown"; }

    async function fetchPGN(gameId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET",
                url: `https://lichess.org/game/export/${gameId}`,
                headers: {"Accept": "application/x-chess-pgn"},
                onload: r => resolve(r.responseText),
                onerror: e => reject(e)
            });
        });
    }

    //////////////////////
    // PANEL + BUTTON
    //////////////////////
    const coachBox = document.createElement("div");
    coachBox.id="lichess-ai-coach";
    coachBox.style.display="none";
    coachBox.innerHTML=`
      <div id="coach-header">♞ AI Coach
        <span id="close-coach" style="float:right;cursor:pointer">✖</span>
      </div>
      <div id="coach-tabs">
        <div class="tab active" data-tab="current">Current</div>
        <div class="tab" data-tab="per-move">Per-move</div>
        <div class="tab" data-tab="full-review">Full Review</div>
        <div class="tab" data-tab="ai-request">AI Request</div>
        <div class="tab" data-tab="config">Config</div>
      </div>
      <div id="current" class="tab-content active">Waiting for move...</div>
      <div id="per-move" class="tab-content">Click refresh button to generate report.</div>
      <div id="full-review" class="tab-content">Click refresh button to generate report.</div>
      <div id="ai-request" class="tab-content">No request generated yet.</div>
      <div id="config" class="tab-content"></div>
    `;
    document.body.appendChild(coachBox);

    const openBtn = document.createElement("button");
    openBtn.id="open-coach-btn";
    openBtn.innerText="Open AI Coach";
    openBtn.style.position="fixed";
    openBtn.style.zIndex="10000";
    openBtn.style.display="none";
    document.body.appendChild(openBtn);

    //////////////////////
    // STYLE
    //////////////////////
    GM_addStyle(`
      #lichess-ai-coach { position: fixed; width: 480px; height: 440px; background: #111; color:#eee; border:1px solid #666; border-radius:8px; font-size:13px; z-index:9999; display:flex; flex-direction:column; resize:both; overflow:hidden; }
      #coach-header { padding:6px; background:#333; cursor:move; font-weight:bold; text-align:center; }
      #coach-tabs { display:flex; border-bottom:1px solid #666; }
      .tab { flex:1; text-align:center; padding:4px; cursor:pointer; background:#222; }
      .tab.active { background:#333; font-weight:bold; }
      .tab-content { flex:1; overflow-y:auto; padding:6px 0px 6px 6px; white-space:pre-wrap; font-family:monospace; display:none; height:100%; position:relative;}
      .tab-content.active { display:block; }
      input, select, button { font-size:12px; background:#333; color:#eee; border:1px solid #666; border-radius:4px; margin:2px; padding:2px 6px; cursor:pointer; }
      button:hover { background:#444; }
      #config label { display:flex; justify-content:space-between; align-items:center; margin:4px 0; }
      #config input, #config select { flex:1; margin-left:6px; }
      #config .button-group { display:flex; gap:6px; margin-top:8px; }
      .refresh-btn { margin-top:6px; display:inline-block; }
      .chat-interface { position: sticky; bottom: 0px; background: black; opacity: 90%; padding: 6px; border-top:1px solid #666; }
      .chat-interface .input-group { display: flex; align-items: stretch; }
      .chat-interface .input-group button { border-radius:4px 0 0 4px; flex-shrink: 0; margin: 0; }
      .chat-interface .input-group textarea { flex-grow: 1; border-radius:0 4px 4px 0; border-left: 0; height: 36px; resize: none; }
      .conversation-log { margin-top: 6px; font-size: 12px; border-top: 1px solid #444; padding-top: 6px; min-height:50px;}
      .conversation-log .user { color: #8af; background: #222; padding: 5px; border-radius: 5px; margin-bottom: 5px; }
      .conversation-log .ai { color: #7f7; background: #222; padding: 5px; border-radius: 5px; margin-bottom: 5px; }
      .conversation-log .user::before { content: "User: "; font-weight: bold; }
      .conversation-log .ai::before { content: "AI: "; font-weight: bold; }
    `);

    //////////////////////
    // PANEL POSITIONING & DRAGGING
    //////////////////////
    let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;

    function copyPosition(from, to) {
        to.style.top = from.style.top;
        to.style.bottom = from.style.bottom;
        to.style.left = from.style.left;
        to.style.right = from.style.right;
    }

    function applyWindowPosition(position) {
        // Reset all position properties to avoid conflicts
        coachBox.style.top = "";
        coachBox.style.bottom = "";
        coachBox.style.left = "";
        coachBox.style.right = "";
        openBtn.style.top = "";
        openBtn.style.bottom = "";
        openBtn.style.left = "";
        openBtn.style.right = "";

        const offset = 10;

        // Apply new position based on the selected preset for both window and button
        switch (position) {
            case "left-bottom":
                coachBox.style.bottom = `${offset}px`;
                coachBox.style.left = `${offset}px`;
                openBtn.style.bottom = `${offset}px`;
                openBtn.style.left = `${offset}px`;
                break;
            case "right-bottom":
                coachBox.style.bottom = `${offset}px`;
                coachBox.style.right = `${offset}px`;
                openBtn.style.bottom = `${offset}px`;
                openBtn.style.right = `${offset}px`;
                break;
            case "left-top":
                coachBox.style.top = `${offset}px`;
                coachBox.style.left = `${offset}px`;
                openBtn.style.top = `${offset}px`;
                openBtn.style.left = `${offset}px`;
                break;
            case "right-top":
                coachBox.style.top = `${offset}px`;
                coachBox.style.right = `${offset}px`;
                openBtn.style.top = `${offset}px`;
                openBtn.style.right = `${offset}px`;
                break;
        }
    }

    // Initial position on load
    const savedPos = JSON.parse(localStorage.getItem("lichessTools-windowCoords") || "null");
    const cfg = loadConfig();

    if (savedPos) {
        coachBox.style.top = savedPos.top;
        coachBox.style.bottom = savedPos.bottom;
        coachBox.style.left = savedPos.left;
        coachBox.style.right = savedPos.right;
        openBtn.style.top = savedPos.top;
        openBtn.style.bottom = savedPos.bottom;
        openBtn.style.left = savedPos.left;
        openBtn.style.right = savedPos.right;
    } else {
        applyWindowPosition(cfg.windowPosition);
    }

    const header = document.getElementById("coach-header");
    header.addEventListener("mousedown", e => {
        isDragging = true;
        dragOffsetX = e.clientX - coachBox.offsetLeft;
        dragOffsetY = e.clientY - coachBox.offsetTop;
        document.body.style.userSelect = "none";
    });
    document.addEventListener("mousemove", e => {
        if (!isDragging) return;
        const newTop = e.clientY - dragOffsetY;
        const newLeft = e.clientX - dragOffsetX;
        if (coachBox.style.bottom) {
            const newBottom = Math.round(window.innerHeight - newTop - coachBox.offsetHeight);
            coachBox.style.bottom = `${newBottom}px`;
            coachBox.style.top = "";
        } else {
            coachBox.style.top = `${Math.round(newTop)}px`;
            coachBox.style.bottom = "";
        }
        if (coachBox.style.right) {
            const newRight = Math.round(window.innerWidth - newLeft - coachBox.offsetWidth);
            coachBox.style.right = `${newRight}px`;
            coachBox.style.left = "";
        } else {
            coachBox.style.left = `${Math.round(newLeft)}px`;
            coachBox.style.right = "";
        }
    });
    document.addEventListener("mouseup", () => {
        if(isDragging){
            isDragging = false;
            document.body.style.userSelect = "";
            localStorage.setItem("lichessTools-windowCoords", JSON.stringify({
                top: coachBox.style.top,
                bottom: coachBox.style.bottom,
                left: coachBox.style.left,
                right: coachBox.style.right
            }));
        }
    });

    //////////////////////
    // CLOSE / OPEN EVENTS
    //////////////////////
    document.getElementById("close-coach").addEventListener("click", ()=>{
        coachBox.style.display="none";
        setCoachClosed(true);
        copyPosition(coachBox, openBtn);
        openBtn.style.display="block";
    });
    openBtn.addEventListener("click", ()=>{
        coachBox.style.display="flex";
        setCoachClosed(false);
        openBtn.style.display="none";
    });

    //////////////////////
    // CONFIG TAB
    //////////////////////
    function renderConfigTab() {
        const cfg = loadConfig();
        const configDiv = document.getElementById("config");
        configDiv.innerHTML=`
            <label><span>Delay (ms):</span> <input type="number" id="cfg-delay" value="${cfg.delay}"></label>
            <label><span>Analysis Level:</span>
                <select id="cfg-level">
                    <option value="simple"${cfg.analysisLevel==="simple"?" selected":""}>Simple</option>
                    <option value="medium"${cfg.analysisLevel==="medium"?" selected":""}>Medium</option>
                    <option value="advanced"${cfg.analysisLevel==="advanced"?" selected":""}>Advanced</option>
                </select>
            </label>
            <label><span>API URL:</span> <input type="text" id="cfg-apiUrl" value="${cfg.apiUrl}"></label>
            <label><span>Model:</span> <input type="text" id="cfg-model" value="${cfg.model}"></label>
            <label><span>Temperature:</span> <input type="number" step="0.1" id="cfg-temp" value="${cfg.temperature}"></label>
            <label><span>Max Tokens:</span> <input type="number" id="cfg-maxTokens" value="${cfg.maxTokens}"></label>
            <label><span>Show AI Request:</span> <input type="checkbox" id="cfg-showAI" ${cfg.showAIRequest?"checked":""}></label>
            <label><span>Window Position:</span>
                <select id="cfg-windowPosition">
                    <option value="left-bottom"${cfg.windowPosition==="left-bottom"?" selected":""}>Left-Bottom</option>
                    <option value="right-bottom"${cfg.windowPosition==="right-bottom"?" selected":""}>Right-Bottom</option>
                    <option value="left-top"${cfg.windowPosition==="left-top"?" selected":""}>Left-Top</option>
                    <option value="right-top"${cfg.windowPosition==="right-top"?" selected":""}>Right-Top</option>
                </select>
            </label>
            <div class="button-group">
              <button id="cfg-save">Save Config</button>
              <button id="cfg-clear-cache">Clear Cache</button>
            </div>
        `;

        document.getElementById("cfg-save").addEventListener("click", ()=>{
            const newCfg = {
                delay: parseInt(document.getElementById("cfg-delay").value),
                analysisLevel: document.getElementById("cfg-level").value,
                apiUrl: document.getElementById("cfg-apiUrl").value,
                model: document.getElementById("cfg-model").value,
                temperature: parseFloat(document.getElementById("cfg-temp").value),
                maxTokens: parseInt(document.getElementById("cfg-maxTokens").value),
                showAIRequest: document.getElementById("cfg-showAI").checked,
                windowPosition: document.getElementById("cfg-windowPosition").value
            };
            saveConfig(newCfg);

            // Always remove custom coordinates and apply the selected preset position on save.
            localStorage.removeItem("lichessTools-windowCoords");
            applyWindowPosition(newCfg.windowPosition);

            alert("Config saved!");
        });
        document.getElementById("cfg-clear-cache").addEventListener("click", ()=>{
            setCache({});
            alert("Cache cleared!");
        });
    }
    renderConfigTab();

    //////////////////////
    // TAB SWITCH
    //////////////////////
    const tabs = coachBox.querySelectorAll(".tab");
    const tabContents = coachBox.querySelectorAll(".tab-content");
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            tabs.forEach(t=>t.classList.remove("active"));
            tab.classList.add("active");
            tabContents.forEach(tc=>tc.classList.remove("active"));
            const target = coachBox.querySelector(`#${tab.dataset.tab}`);
            if(target) target.classList.add("active");

            if(tab.dataset.tab==="per-move"){
                generatePerMoveFull(false);
            }

            if(tab.dataset.tab==="full-review"){
                generateFullReview(false);
            }

            if(tab.dataset.tab==="ai-request"){
                const info = getCurrentMoveInfo();
                const gameState = getGameState();
                target.innerText = lastRequestText || `Prompt will be generated here:

Current move: ${info.san} (Index: ${info.moveIndex})
Evaluation: ${info.evaluation}
Player: ${USERNAME} (${getPlayerColor()})
Game context:
${gameState}`;
            }
        });
    });

    //////////////////////
    // AI REQUEST FUNCTION
    //////////////////////
    let lastRequestText = "";
    const USERNAME = document.getElementById("user_tag")?.textContent || "unknown"; // Dynamically fetch username

    function askAI(messages){
        const cfg = loadConfig();
        messages = [{role: "system", content: "You are a chess coach."}, ...messages];
        lastRequestText = messages.map(m => m.role + ": " + m.content).join("\n");

        return new Promise((resolve,reject)=>{
            GM_xmlhttpRequest({
                method:"POST",
                url: cfg.apiUrl,
                headers: {"Content-Type":"application/json"},
                data: JSON.stringify({model:cfg.model, messages, temperature:cfg.temperature, max_tokens:cfg.maxTokens}),
                onload:r=>{ try{ const j=JSON.parse(r.responseText); resolve(j.choices?.[0]?.message?.content||"No response"); } catch(e){ reject("Parse error: "+e); } },
                onerror:e=>reject("GM_xmlhttpRequest error: "+e)
            });
        });
    }

    //////////////////////
    // STYLE PROMPTS
    //////////////////////
    const currentStylePrompt = {
        simple: `You are a chess coach for beginners.
Given the current move and Stockfish’s evaluation, write a 1–2 sentence simple comment explaining:
What this move does.
If it's good or bad.
What to do next.`,

        medium: `You are a chess coach for intermediate players.
Given the current move, Stockfish’s evaluation, and the full game moves, write a 2–3 sentence practical comment explaining:
What this move aims to do.
If it follows or deviates from best play.
What plan should follow next.`,

        advanced: `You are a chess coach for advanced players.
Given the current move and Stockfish’s evaluation, write a 2–3 sentence practical comment explaining:
What this move aims to do.
If it follows or deviates from best play.
What plan should follow next.`
    };

    const perMoveStylePrompt = {
        simple: `You are a careful chess coach. Provide a **line-by-line** analysis for each ply.
Follow this structure:
<Ply-Number>. <SAN-move> — <Assessment-short> — <Why/Notes (1-2 concise sentences)> [if applicable: {Tactic/Idea keywords}]
Rules:
- Keep each line to at most 25 words.
- Keep SAN moves exactly as given.
- Mark Good/Winning, Mistake/Blunder where relevant.
- Top line: one-sentence summary of position and who is better.
Keep explanations beginner-friendly.`,

        medium: `You are a careful chess coach. Provide a **line-by-line** analysis for each ply.
Follow this structure:
<Ply-Number>. <SAN-move> — <Assessment-short> — <Why/Notes (1-2 concise sentences)> [if applicable: {Tactic/Idea keywords}]
Rules:
- Max 25 words per line.
- SAN moves must stay exact.
- Point out tactical motifs, strategic goals.
- Mark errors clearly.
Write as if guiding an improving player.`,

        advanced: `You are a careful chess coach. Provide a **line-by-line** analysis for each ply.
Follow this structure:
<Ply-Number>. <SAN-move> — <Assessment-short> — <Why/Notes (1-2 concise sentences)> [if applicable: {Tactic/Idea keywords}]
Rules:
- Strict SAN notation.
- ≤25 words per ply.
- Highlight tactics, plans, deep strategy.
- Mark blunders, improvements, critical moments.
- Start with: one-sentence summary who is better.
Audience: advanced players wanting detailed move-by-move annotations.`
    };

    const fullReviewStylePrompt = {
        simple: `You are a chess coach providing a full review of this game.
Summarize who was better in each phase (opening, middlegame, endgame).
Highlight key turning points, recurring mistakes, and missed chances.
Suggest how the player can improve strategically and tactically.
Keep it simple and beginner-friendly.`,

        medium: `You are a chess coach providing a full review of this game.
Summarize who was better in each phase (opening, middlegame, endgame).
Highlight key turning points, recurring mistakes, and missed chances.
Suggest how the player can improve strategically and tactically.
Write as if guiding an improving player.`,

        advanced: `You are a chess coach providing a full review of this game.
Summarize who was better in each phase (opening, middlegame, endgame).
Highlight key turning points, recurring mistakes, and missed chances.
Suggest how the player can improve strategically and tactically.
Audience: advanced players wanting detailed insights.`
    };

    //////////////////////
    // CURRENT ANALYSIS + REFRESH
    //////////////////////
    let lastActive="", analysisTimer=null;
    const currentDiv = document.getElementById("current");

    async function generateCurrent(force=false){
        const info=getCurrentMoveInfo();
        const cfg=loadConfig();
        const cache=getCache();
        const key=getGameId()+"_"+info.moveIndex;

        let explanation;
        if(!force && cache[key]){
            explanation = cache[key];
            currentDiv.innerHTML = `<div style="position:absolute;top:0;left:0;width:100%;background:#444;color:#fff;opacity:0.9;padding:4px;text-align:center;">⚡ Using cached analysis</div><div style="margin-top:20px;" class="analysis-content">${explanation}</div><button class="refresh-btn" id="refresh-current">🔄 Refresh</button><div id="conversation-current" class="conversation-log"></div><div class="chat-interface"><div class="input-group"><button id="send-ai-current">Send</button><textarea id="user-prompt-current" placeholder="Ask the AI about this analysis..."></textarea></div></div>`;
            setTimeout(()=>{
                const notice = currentDiv.querySelector("div");
                if(notice) notice.remove();
            },1000);
        } else {
            currentDiv.innerText="Analysing with LM Studio...";
            try{
                const pgn = await fetchPGN(getGameId());
                const content=`Current move: ${info.san} (Index: ${info.moveIndex})\nEvaluation: ${info.evaluation}\nPlayer: ${USERNAME} (${getPlayerColor()})\nFull PGN:\n${pgn}\nStockfish PV: ${info.pvLine}`;
                const initialPrompt = currentStylePrompt[cfg.analysisLevel];
                explanation=await askAI([{role: "user", content: initialPrompt + "\n" + content}]);
                cache[key]=explanation;
                setCache(cache);
                currentDiv.innerHTML=`<div class="analysis-content">${explanation}</div><button class="refresh-btn" id="refresh-current">🔄 Refresh</button><div id="conversation-current" class="conversation-log"></div><div class="chat-interface"><div class="input-group"><button id="send-ai-current">Send</button><textarea id="user-prompt-current" placeholder="Ask the AI about this analysis..."></textarea></div></div>`;
            }catch(e){ currentDiv.innerText="Error: "+e; return; }
        }

        document.getElementById("refresh-current").addEventListener("click",()=>generateCurrent(true));

        document.getElementById("send-ai-current").addEventListener("click", async () => {
            const sendButton = document.getElementById("send-ai-current");
            const userInput = document.getElementById("user-prompt-current").value;
            if (!userInput) return;
            const conversationDiv = document.getElementById("conversation-current");
            conversationDiv.innerHTML += `<div class="user">${userInput}</div>`;
            document.getElementById("user-prompt-current").value = '';
            sendButton.innerText = 'Thinking...';
            sendButton.disabled = true;
            try {
                const response = await askAI([{role: "user", content: userInput}]);
                conversationDiv.innerHTML += `<div class="ai">${response}</div>`;
            } catch(e) {
                conversationDiv.innerHTML += `<div class="ai">Error: ${e}</div>`;
            } finally {
                sendButton.innerText = 'Send';
                sendButton.disabled = false;
            }
        });
    }

    const observer = new MutationObserver(()=>{
        const ceval = document.querySelector(".analyse__tools .ceval.enabled");
        if(!ceval){ coachBox.style.display="none"; openBtn.style.display="none"; return; }
        if(isCoachClosed()){ coachBox.style.display="none"; copyPosition(coachBox, openBtn); openBtn.style.display="block"; }
        else { coachBox.style.display="flex"; openBtn.style.display="none"; }

        const activeEl = document.querySelector("move.mainline.active");
        if(!activeEl) return;
        const activeId = activeEl.getAttribute("p");
        if(activeId === lastActive) return;
        lastActive = activeId;

        if(analysisTimer) clearTimeout(analysisTimer);
        currentDiv.innerText="Move selected: waiting ...";
        analysisTimer=setTimeout(()=>generateCurrent(false), loadConfig().delay);
    });
    observer.observe(document.body,{childList:true,subtree:true});

    //////////////////////
    // PER-MOVE FULL (new, like full review but for moves)
    //////////////////////
    const perMoveDiv = document.getElementById("per-move");
    async function generatePerMoveFull(force=false) {
        const cfg = loadConfig();
        const cache = getCache();
        const key = getGameId() + "_perMoveFull";
        let analysis;
        if (!force && cache[key]) {
            analysis = cache[key];
            perMoveDiv.innerHTML = `<div style="position:absolute;top:0;left:0;width:100%;background:#444;color:#fff;opacity:0.9;padding:4px;text-align:center;">⚡ Using cached analysis</div><div style="margin-top:20px;" class="analysis-content">${analysis}</div><button class="refresh-btn" id="refresh-per-move">🔄 Refresh</button><div id="conversation-per-move" class="conversation-log"></div><div class="chat-interface"><div class="input-group"><button id="send-ai-per-move">Send</button><textarea id="user-prompt-per-move" placeholder="Ask the AI about this analysis..."></textarea></div></div>`;
            setTimeout(()=>{
                const notice = perMoveDiv.querySelector("div");
                if(notice) notice.remove();
            },1000);
        } else {
            perMoveDiv.innerText = "Generating per-move analysis...";
            try {
                const pgn = await fetchPGN(getGameId());
                const initialPrompt = perMoveStylePrompt[cfg.analysisLevel];
                const initialContent = "PGN:\n" + pgn;
                analysis = await askAI([{role: "user", content: initialPrompt + "\n" + initialContent}]);
                cache[key] = analysis;
                setCache(cache);
                perMoveDiv.innerHTML = `<div class="analysis-content">${analysis}</div><button class="refresh-btn" id="refresh-per-move">🔄 Refresh</button><div id="conversation-per-move" class="conversation-log"></div><div class="chat-interface"><div class="input-group"><button id="send-ai-per-move">Send</button><textarea id="user-prompt-per-move" placeholder="Ask the AI about this analysis..."></textarea></div></div>`;
            } catch(e) {
                perMoveDiv.innerText = "Error: " + e;
                return;
            }
        }

        document.getElementById("refresh-per-move").addEventListener("click",()=>generatePerMoveFull(true));

        document.getElementById("send-ai-per-move").addEventListener("click", async () => {
            const sendButton = document.getElementById("send-ai-per-move");
            const userInput = document.getElementById("user-prompt-per-move").value;
            if (!userInput) return;
            const conversationDiv = document.getElementById("conversation-per-move");
            conversationDiv.innerHTML += `<div class="user">${userInput}</div>`;
            document.getElementById("user-prompt-per-move").value = '';
            sendButton.innerText = 'Thinking...';
            sendButton.disabled = true;
            try {
                const response = await askAI([{role: "user", content: userInput}]);
                conversationDiv.innerHTML += `<div class="ai">${response}</div>`;
            } catch(e) {
                conversationDiv.innerHTML += `<div class="ai">Error: ${e}</div>`;
            } finally {
                sendButton.innerText = 'Send';
                sendButton.disabled = false;
            }
        });
    }

    //////////////////////
    // FULL REVIEW (with cache + refresh)
    //////////////////////
    const fullDiv=document.getElementById("full-review");
    async function generateFullReview(force=false) {
        const cfg = loadConfig();
        const cache = getCache();
        const key = getGameId() + "_fullReview";
        let review;
        if (!force && cache[key]) {
            review = cache[key];
            fullDiv.innerHTML = `<div style="position:absolute;top:0;left:0;width:100%;background:#444;color:#fff;opacity:0.9;padding:4px;text-align:center;">⚡ Using cached review</div><div style="margin-top:20px;" class="analysis-content">${review}</div><button class="refresh-btn" id="refresh-full">🔄 Refresh</button><div id="conversation-full-review" class="conversation-log"></div><div class="chat-interface"><div class="input-group"><button id="send-ai-full-review">Send</button><textarea id="user-prompt-full-review" placeholder="Ask the AI about this analysis..."></textarea></div></div>`;
            setTimeout(()=>{
                const notice = fullDiv.querySelector("div");
                if(notice) notice.remove();
            },1000);
        } else {
            fullDiv.innerText = "Generating full review...";
            try {
                const pgn = await fetchPGN(getGameId());
                const summary=document.querySelector(".advice-summary")?.innerText||"";
                const initialPrompt = fullReviewStylePrompt[cfg.analysisLevel];
                const initialContent = "PGN:\n" + pgn + "\n\nSummary:\n" + summary;
                review = await askAI([{role: "user", content: initialPrompt + "\n" + initialContent}]);
                cache[key] = review;
                setCache(cache);
                fullDiv.innerHTML = `<div class="analysis-content">${review}</div><button class="refresh-btn" id="refresh-full">🔄 Refresh</button><div id="conversation-full-review" class="conversation-log"></div><div class="chat-interface"><div class="input-group"><button id="send-ai-full-review">Send</button><textarea id="user-prompt-full-review" placeholder="Ask the AI about this analysis..."></textarea></div></div>`;
            } catch(e) {
                fullDiv.innerText = "Error: " + e;
                return;
            }
        }

        document.getElementById("refresh-full").addEventListener("click",()=>generateFullReview(true));

        document.getElementById("send-ai-full-review").addEventListener("click", async () => {
            const sendButton = document.getElementById("send-ai-full-review");
            const userInput = document.getElementById("user-prompt-full-review").value;
            if (!userInput) return;
            const conversationDiv = document.getElementById("conversation-full-review");
            conversationDiv.innerHTML += `<div class="user">${userInput}</div>`;
            document.getElementById("user-prompt-full-review").value = '';
            sendButton.innerText = 'Thinking...';
            sendButton.disabled = true;
            try {
                const response = await askAI([{role: "user", content: userInput}]);
                conversationDiv.innerHTML += `<div class="ai">${response}</div>`;
            } catch(e) {
                conversationDiv.innerHTML += `<div class="ai">Error: ${e}</div>`;
            } finally {
                sendButton.innerText = 'Send';
                sendButton.disabled = false;
            }
        });
    }

    //////////////////////
    // HELPER FUNCTIONS
    //////////////////////
    function getPlayerColor(){
        const pgnText = document.querySelector(".pgn")?.textContent || "";
        const whiteMatch = pgnText.match(/\[White\s+"(.+?)"\]/);
        const blackMatch = pgnText.match(/\[Black\s+"(.+?)"\]/);
        if(whiteMatch?.[1] === USERNAME) return "white";
        if(blackMatch?.[1] === USERNAME) return "black";
        return "unknown";
    }

    function getActiveMoveIndex(){
        const hashIndex=parseInt(window.location.hash.replace("#",""))-1;
        return !isNaN(hashIndex)&&hashIndex>=0?hashIndex:0;
    }

    function getCurrentMoveInfo(){
        const activeMove=document.querySelector("move.mainline.active");
        if(!activeMove) return {san:"N/A",evaluation:"N/A",moveIndex:0,pvLine:""};
        const san=activeMove.querySelector("san")?.innerText||"N/A";
        const evaluation=activeMove.querySelector("eval")?.innerText||"N/A";
        const moveIndex=getActiveMoveIndex();
        const pvBox=document.querySelector(".pv_box");
        let pvLine="";
        if(pvBox) pvLine=Array.from(pvBox.querySelectorAll(".pv-san")).map(s=>s.innerText).join(" ");
        return {san,evaluation,moveIndex,pvLine};
    }

    function getGameState(){
        const moves=[...document.querySelectorAll(".analyse__moves move.mainline")].map(m=>m.querySelector("san")?.innerText||"").filter(x=>x);
        const info=getCurrentMoveInfo();
        if(info.pvLine) return moves.join(" ")+"\n\nStockfish PV (Index: "+(info.moveIndex+1)+"): "+info.pvLine;
        return moves.join(" ");
    }

})();
