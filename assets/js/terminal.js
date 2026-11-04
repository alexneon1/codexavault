(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const STORAGE = {
    files: 'cx_workspace_fs', tabs: 'cx_terminal_tabs', active: 'cx_terminal_active',
    history: 'cx_terminal_history'
  };
  const SEED_FILES = {
    '/main.js': 'console.log("Hello from CodeXavault!");\nconst total = 2 + 3;\nconsole.log("2 + 3 =", total);',
    '/app.py': 'print("Hello from CodeXavault Python!")\nfor number in range(1, 4):\n    print(number)',
    '/README.md': '# My CodeXavault Project\n\nProject files are shared between the editor and terminal.'
  };
  const read = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (error) { notify(`Could not save data: ${error.message}`); return false; }
  };
  const notify = message => window.dispatchEvent(new CustomEvent('cx-toast', { detail: message }));
  let files = { ...SEED_FILES, ...read(STORAGE.files, {}) };
  let tabs = read(STORAGE.tabs, [{ id: 'terminal-1', name: 'Terminal 1', cwd: '/' }]);
  if (!Array.isArray(tabs) || !tabs.length) tabs = [{ id: 'terminal-1', name: 'Terminal 1', cwd: '/' }];
  tabs = tabs.filter(tab => tab && typeof tab.id === 'string').map((tab, i) => ({
    id: tab.id, name: String(tab.name || `Terminal ${i + 1}`).slice(0, 32), cwd: normalize(tab.cwd || '/')
  }));
  let activeId = read(STORAGE.active, tabs[0].id);
  if (!tabs.some(tab => tab.id === activeId)) activeId = tabs[0].id;
  let histories = read(STORAGE.history, {});
  if (!histories || typeof histories !== 'object' || Array.isArray(histories)) histories = {};
  let worker = null;
  let stopWorker = null;
  let pyodidePromise = null;
  let activeFile = '/main.js';
  let inputQueue = [];

  function normalize(path) {
    const parts = String(path || '/').replace(/\\/g, '/').split('/');
    const stack = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') stack.pop(); else stack.push(part);
    }
    return '/' + stack.join('/');
  }
  function resolvePath(cwd, value) { return normalize(value.startsWith('/') ? value : `${cwd}/${value}`); }
  function currentTab() { return tabs.find(tab => tab.id === activeId) || tabs[0]; }
  function persist() {
    write(STORAGE.files, files); write(STORAGE.tabs, tabs);
    write(STORAGE.active, activeId); write(STORAGE.history, histories);
  }
  function print(message, kind = 'normal') {
    const output = $('#terminalOutput'); if (!output) return;
    const line = document.createElement('div'); line.className = `terminal-line ${kind}`;
    line.textContent = String(message); output.append(line); output.scrollTop = output.scrollHeight;
  }
  function clearOutput() { const output = $('#terminalOutput'); if (output) output.replaceChildren(); }
  function renderTabs() {
    const host = $('#terminalTabs'); if (!host) return;
    host.replaceChildren();
    tabs.forEach(tab => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = `terminal-tab${tab.id === activeId ? ' active' : ''}`;
      button.setAttribute('aria-pressed', String(tab.id === activeId));
      const label = document.createElement('span'); label.textContent = tab.name;
      const close = document.createElement('span'); close.className = 'terminal-tab-close';
      close.textContent = '×'; close.title = `Close ${tab.name}`; close.setAttribute('role', 'button');
      close.addEventListener('click', event => { event.stopPropagation(); closeTab(tab.id); });
      button.append(label, close); button.addEventListener('click', () => switchTab(tab.id)); host.append(button);
    });
    const add = document.createElement('button'); add.type = 'button'; add.className = 'terminal-new-tab';
    add.textContent = '+'; add.title = 'New terminal'; add.setAttribute('aria-label', 'New terminal');
    add.addEventListener('click', newTab); host.append(add);
  }
  function switchTab(id) { activeId = id; persist(); renderTabs(); renderOutput(); }
  function newTab() {
    if (tabs.length >= 8) { print('You can have up to 8 terminal tabs.', 'error'); return; }
    const id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    tabs.push({ id, name: `Terminal ${tabs.length + 1}`, cwd: currentTab().cwd });
    activeId = id; persist(); renderTabs(); renderOutput(); $('#terminalCommand')?.focus();
  }
  function closeTab(id) {
    if (tabs.length === 1) { print('The last terminal tab cannot be closed.', 'error'); return; }
    tabs = tabs.filter(tab => tab.id !== id); delete histories[id];
    if (activeId === id) activeId = tabs[0].id;
    persist(); renderTabs(); renderOutput();
  }
  function renderOutput() {
    clearOutput(); const history = histories[activeId] || [];
    history.forEach(record => {
      print(`$ ${record.command}`, 'command');
      (record.output || []).forEach(item => print(item.text, item.kind));
    });
    const cwd = $('#terminalCwd'); if (cwd) cwd.textContent = currentTab().cwd;
  }
  function childNames(directory) {
    const prefix = directory === '/' ? '/' : `${directory}/`;
    return [...new Set(Object.keys(files).filter(path => path.startsWith(prefix))
      .map(path => path.slice(prefix.length).split('/')[0]).filter(Boolean))].sort();
  }
  function emitTo(record, message, kind = 'normal') {
    const item = { text: String(message), kind }; record.output.push(item); print(item.text, kind);
  }
  async function executeCommand(raw) {
    const commandLine = raw.trim(); if (!commandLine) return;
    const tab = currentTab(); const record = { command: commandLine, output: [] };
    const emit = (message, kind) => emitTo(record, message, kind);
    print(`$ ${commandLine}`, 'command');
    const [command, ...rest] = commandLine.split(/\s+/); const argument = rest.join(' ');
    try {
      switch (command.toLowerCase()) {
        case 'help': emit('Commands: help, ls, pwd, cd, cat, mkdir, touch, rm, clear, history, node <file>, python <file>'); emit('JavaScript programs can use: await readLine("Prompt: ")'); break;
        case 'clear': clearOutput(); histories[activeId] = []; break;
        case 'pwd': emit(tab.cwd); break;
        case 'ls': { const names = childNames(tab.cwd); emit(names.length ? names.join('    ') : '(empty directory)'); break; }
        case 'cd': { const target = resolvePath(tab.cwd, argument || '/');
          if (target !== '/' && !Object.keys(files).some(path => path.startsWith(`${target}/`) || path === `${target}/.directory`)) emit(`cd: ${argument}: directory not found`, 'error');
          else { tab.cwd = target; const cwd = $('#terminalCwd'); if (cwd) cwd.textContent = target; persist(); } break; }
        case 'cat': { if (!argument) { emit('cat: provide a file path', 'error'); break; } const path = resolvePath(tab.cwd, argument); if (!(path in files)) emit(`cat: ${argument}: file not found`, 'error'); else emit(files[path]); break; }
        case 'touch': { if (!argument) { emit('touch: provide a filename', 'error'); break; } const path = resolvePath(tab.cwd, argument); if (path.endsWith('/')) throw new Error('Invalid file path'); files[path] ??= ''; persist(); emit(`Created ${path}`, 'success'); window.dispatchEvent(new Event('cx-files-changed')); break; }
        case 'mkdir': { if (!argument) { emit('mkdir: provide a directory name', 'error'); break; } const path = resolvePath(tab.cwd, argument); files[`${path}/.directory`] ??= ''; persist(); emit(`Created directory ${path}`, 'success'); window.dispatchEvent(new Event('cx-files-changed')); break; }
        case 'rm': { if (!argument) { emit('rm: provide a file path', 'error'); break; } const path = resolvePath(tab.cwd, argument); if (!(path in files)) emit(`rm: ${argument}: file not found`, 'error'); else { delete files[path]; persist(); emit(`Removed ${path}`, 'success'); window.dispatchEvent(new Event('cx-files-changed')); } break; }
        case 'history': (histories[activeId] || []).slice(-20).forEach((item, index) => emit(`${index + 1}  ${item.command}`)); break;
        case 'node': case 'javascript': { const path = resolvePath(tab.cwd, argument); if (!(path in files)) emit(`File not found: ${argument}`, 'error'); else await runJavaScript(files[path], emit); break; }
        case 'python': case 'python3': { const path = resolvePath(tab.cwd, argument); if (!(path in files)) emit(`File not found: ${argument}`, 'error'); else await runPython(files[path], emit); break; }
        default: emit(`${command}: command not available. Type help to see supported commands.`, 'error');
      }
    } catch (error) { emit(error.message || 'Command failed.', 'error'); }
    if (command.toLowerCase() !== 'clear') {
      histories[activeId] ||= []; histories[activeId].push(record);
      histories[activeId] = histories[activeId].slice(-80); persist();
    } else persist();
  }
  function runJavaScript(code, emit) {
    return new Promise(resolve => {
      if (worker) worker.terminate();
      const source = `let pendingInput = []; let inputWaiter = null;
        const safeConsole = Object.freeze({
          log: (...args) => postMessage({type:'log', value:args.map(String).join(' ')}),
          info: (...args) => postMessage({type:'log', value:args.map(String).join(' ')}),
          warn: (...args) => postMessage({type:'warn', value:args.map(String).join(' ')}),
          error: (...args) => postMessage({type:'error', value:args.map(String).join(' ')})
        });
        const readLine = promptText => new Promise(resolve => { postMessage({type:'prompt', value:promptText || 'Input:'}); inputWaiter = resolve; if(pendingInput.length) inputWaiter(pendingInput.shift()); });
        onmessage = async event => {
          if(event.data && event.data.type === 'input'){ if(inputWaiter){const done=inputWaiter;inputWaiter=null;done(event.data.value);}else pendingInput.push(event.data.value); return; }
          if(typeof event.data !== 'string') return;
          try { const runner = new Function('console', 'readLine', 'return (async function(){ \\n' + event.data + '\\n }).call(undefined);'); const result = await runner(safeConsole, readLine);
            if(result !== undefined) postMessage({type:'result', value:String(result)});
            postMessage({type:'done'});
          } catch(error) { postMessage({type:'error', value:error && error.stack ? error.stack : String(error)}); postMessage({type:'done'}); }
        };`;
      const blob = new Blob([source], { type: 'text/javascript' }); const url = URL.createObjectURL(blob);
      worker = new Worker(url); let finished = false;
      const finish = () => { if (finished) return; finished = true; clearTimeout(timer); worker?.terminate(); worker = null; stopWorker = null; URL.revokeObjectURL(url); resolve(); };
      stopWorker = finish;
      const timer = setTimeout(() => { emit('Execution stopped: 5-minute safety time limit reached.', 'error'); finish(); }, 300000);
      worker.onmessage = event => {
        const data = event.data || {};
        if (data.type === 'log' || data.type === 'result') emit(data.value);
        else if (data.type === 'warn') emit(data.value, 'muted');
        else if (data.type === 'error') emit(data.value, 'error');
        else if (data.type === 'prompt') { const prompt = $('#programInput'); if (prompt) { prompt.placeholder = data.value || 'Program input…'; prompt.focus(); } }
        else if (data.type === 'done') finish();
      };
      worker.onerror = event => { emit(event.message || 'JavaScript execution failed.', 'error'); finish(); };
      worker.postMessage(code);
    });
  }
  async function loadPython() {
    if (window.loadPyodide) return window.loadPyodide();
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.js';
      script.onload = resolve; script.onerror = () => reject(new Error('Python runtime could not load. Check your internet connection.'));
      document.head.append(script);
    });
    return window.loadPyodide();
  }
  async function runPython(code, emit) {
    emit('Loading Python runtime (Pyodide)…', 'muted');
    try {
      if (!pyodidePromise) pyodidePromise = loadPython();
      const pyodide = await pyodidePromise;
      pyodide.setStdout({ batched: text => emit(text) });
      pyodide.setStderr({ batched: text => emit(text, 'error') });
      await pyodide.runPythonAsync(code);
    } catch (error) { emit(error.message || 'Python execution failed.', 'error'); pyodidePromise = null; }
  }
  function initEditor() {
    const editor = $('#codeInput'); if (!editor) return;
    const fileButtons = [...document.querySelectorAll('[data-file]')];
    const initial = fileButtons.find(button => button.classList.contains('active')) || fileButtons[0];
    activeFile = normalize('/' + (initial?.dataset.file || 'main.js'));
    if (!(activeFile in files)) files[activeFile] = editor.value;
    editor.value = files[activeFile];
    const lineNumbers = $('#lineNumbers');
    const updateLines = () => { if (lineNumbers) lineNumbers.textContent = Array.from({ length: editor.value.split('\n').length }, (_, i) => i + 1).join('\n'); };
    const saveEditor = () => { files[activeFile] = editor.value; write(STORAGE.files, files); updateLines(); const status = $('.saved-label'); if (status) status.innerHTML = '<i></i> Saved locally'; };
    editor.addEventListener('input', saveEditor); updateLines();
    fileButtons.forEach(button => button.addEventListener('click', () => {
      saveEditor(); fileButtons.forEach(item => item.classList.toggle('active', item === button));
      activeFile = normalize('/' + button.dataset.file); editor.value = files[activeFile] ?? '';
      const activeLabel = $('#activeFile'); if (activeLabel) activeLabel.textContent = button.dataset.file;
      updateLines();
    }));
    window.addEventListener('cx-files-changed', () => { if (activeFile in files) editor.value = files[activeFile]; updateLines(); });
    window.addEventListener('cx-run-editor-code', () => {
      const extension = activeFile.split('.').pop().toLowerCase();
      const input = $('#terminalCommand'); if (input) input.value = '';
      print(`$ run ${activeFile}`, 'command');
      const emit = (message, kind) => print(message, kind);
      if (extension === 'js' || extension === 'mjs') runJavaScript(editor.value, emit);
      else if (extension === 'py') runPython(editor.value, emit);
      else print(`Run is supported for .js and .py files, not .${extension}.`, 'error');
    });
  }
  function init() {
    if (!$('#terminalOutput')) return;
    renderTabs(); renderOutput();
    const form = $('#terminalForm'); const commandInput = $('#terminalCommand');
    form?.addEventListener('submit', event => { event.preventDefault(); const value = commandInput.value; commandInput.value = ''; executeCommand(value); });
    $('#terminalClear')?.addEventListener('click', () => { clearOutput(); histories[activeId] = []; persist(); });
    $('#terminalStop')?.addEventListener('click', () => { if (worker && stopWorker) { print('JavaScript execution stopped by user.', 'muted'); stopWorker(); } else print('No JavaScript worker is running.', 'muted'); });
    $('#terminalRename')?.addEventListener('click', () => {
      const name = window.prompt('Name this terminal session', currentTab().name);
      if (name && name.trim()) { currentTab().name = name.trim().slice(0, 32); persist(); renderTabs(); }
    });
    $('#terminalInputSend')?.addEventListener('click', () => {
      const input = $('#programInput'); if (!input || !input.value.trim()) return;
      const value = input.value; input.value = ''; print(`› ${value}`, 'input');
      if (worker) worker.postMessage({ type: 'input', value });
      else print('No program is currently waiting for input. JavaScript can request input with await readLine().', 'muted');
    });
    commandInput?.addEventListener('keydown', event => {
      const history = histories[activeId] || []; let index = Number(commandInput.dataset.historyIndex ?? history.length);
      if (event.key === 'ArrowUp') { event.preventDefault(); index = Math.max(0, index - 1); commandInput.value = history[index]?.command || ''; commandInput.dataset.historyIndex = String(index); }
      if (event.key === 'ArrowDown') { event.preventDefault(); index = Math.min(history.length, index + 1); commandInput.value = history[index]?.command || ''; commandInput.dataset.historyIndex = String(index); }
    });
    commandInput?.addEventListener('input', () => delete commandInput.dataset.historyIndex);
    initEditor();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
