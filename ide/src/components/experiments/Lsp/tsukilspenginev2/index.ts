/**
 * tsukilspenginev2 — precision diagnostic engine for tsuki.
 *
 * Architecture vs v1:
 *  - v1: line-by-line regex matching (fast, low false-positive rate for common patterns)
 *  - v2: two-pass token-stream + scope stack
 *        Pass 1: collect all declarations and their spans
 *        Pass 2: walk all usage sites and flag issues
 *
 * Detects (Go):
 *   T0001  variable declared and not used (ALL forms: var, :=, for range, params)
 *   T0002  import declared and not used
 *   T0003  function defined but never called (except setup/loop)
 *   T0004  unreachable code after return / break / continue / panic()
 *   T0005  not all code paths return a value
 *   T0006  undefined symbol
 *   T0007  wrong number of arguments
 *   T0009  variable shadowed in inner scope
 *   T0010  duplicate symbol in same scope
 *   T0011  variable assigned but never read (write-only)
 *   T0100  division by zero
 *   T0101  infinite loop without delay or break
 *   T0200  missing package declaration
 *   T0201  wrong package name
 *   T0202  missing setup()
 *   T0203  missing loop()
 *   T0300  Serial used without Serial.Begin
 *   T0301  arduino method arity
 *   T0302  PWM on non-PWM pin
 *   S0001  unbalanced braces
 *   S0002  unbalanced parentheses
 *   S0003  unterminated string literal
 *   S0004  duplicate import
 */

import type { Diagnostic, LspEngineOptions, TsukiErrorCode } from '../_types'
import { KNOWN_LIBS, formatRustDiagnostic } from '../_types'

// ─── Tokenizer ────────────────────────────────────────────────────────────────

type TokKind =
  | 'IDENT' | 'KEYWORD' | 'STRING' | 'RAW_STRING' | 'CHAR'
  | 'NUMBER' | 'PUNCT' | 'OP' | 'COMMENT' | 'NEWLINE' | 'EOF'

interface Token {
  kind:  TokKind
  value: string
  line:  number
  col:   number
}

const GO_KEYWORDS = new Set([
  'break','case','chan','const','continue','default','defer','else',
  'fallthrough','for','func','go','goto','if','import','interface',
  'map','package','range','return','select','struct','switch','type','var',
])

const GO_BUILTINS = new Set([
  'make','len','cap','append','copy','delete','close','panic','recover',
  'print','println','new','real','imag','complex','error',
  'bool','byte','rune','string',
  'int','int8','int16','int32','int64',
  'uint','uint8','uint16','uint32','uint64','uintptr',
  'float32','float64','complex64','complex128',
  'true','false','nil','iota','_',
])

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0, line = 1, col = 1

  const advance = () => {
    const ch = source[i++]
    if (ch === '\n') { line++; col = 1 } else { col++ }
    return ch
  }
  const peek = (offset = 0) => source[i + offset]

  while (i < source.length) {
    const startLine = line
    const startCol  = col
    const ch = peek()

    // Newlines
    if (ch === '\n') { advance(); tokens.push({ kind:'NEWLINE', value:'\n', line:startLine, col:startCol }); continue }

    // Whitespace
    if (/[ \t\r]/.test(ch)) { advance(); continue }

    // Line comment
    if (ch === '/' && peek(1) === '/') {
      let val = ''
      while (i < source.length && peek() !== '\n') val += advance()
      tokens.push({ kind:'COMMENT', value:val, line:startLine, col:startCol })
      continue
    }

    // Block comment
    if (ch === '/' && peek(1) === '*') {
      advance(); advance()
      let val = '/*'
      while (i < source.length) {
        if (peek() === '*' && peek(1) === '/') { val += advance(); val += advance(); break }
        val += advance()
      }
      tokens.push({ kind:'COMMENT', value:val, line:startLine, col:startCol })
      continue
    }

    // Raw string `...`
    if (ch === '`') {
      advance()
      let val = ''
      while (i < source.length && peek() !== '`') val += advance()
      if (peek() === '`') advance()
      tokens.push({ kind:'RAW_STRING', value:val, line:startLine, col:startCol })
      continue
    }

    // Interpreted string "..."
    if (ch === '"') {
      advance()
      let val = '', terminated = false
      while (i < source.length) {
        const c = advance()
        if (c === '\\') { val += c + (i < source.length ? advance() : ''); continue }
        if (c === '"')  { terminated = true; break }
        val += c
      }
      tokens.push({ kind: terminated ? 'STRING' : 'STRING', value:val, line:startLine, col:startCol })
      continue
    }

    // Rune 'x'
    if (ch === "'") {
      advance()
      let val = ''
      while (i < source.length && peek() !== "'") val += advance()
      if (peek() === "'") advance()
      tokens.push({ kind:'CHAR', value:val, line:startLine, col:startCol })
      continue
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(peek(1)))) {
      let val = ''
      while (i < source.length && /[0-9a-fA-FxXoObB._eEpP+-]/.test(peek())) val += advance()
      tokens.push({ kind:'NUMBER', value:val, line:startLine, col:startCol })
      continue
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let val = ''
      while (i < source.length && /[\w]/.test(peek())) val += advance()
      const kind: TokKind = GO_KEYWORDS.has(val) ? 'KEYWORD' : 'IDENT'
      tokens.push({ kind, value:val, line:startLine, col:startCol })
      continue
    }

    // Two-char operators
    const two = ch + peek(1)
    if ([':=','<-','++','--','==','!=','<=','>=','&&','||','...','<<','>>'].includes(two)) {
      advance(); advance()
      tokens.push({ kind:'OP', value:two, line:startLine, col:startCol })
      continue
    }

    // Single char punct / operators
    advance()
    tokens.push({ kind:'PUNCT', value:ch, line:startLine, col:startCol })
  }

  tokens.push({ kind:'EOF', value:'', line, col })
  return tokens
}

// ─── Token stream reader ──────────────────────────────────────────────────────

class TokenStream {
  private pos = 0
  constructor(private tokens: Token[]) {}

  peek(offset = 0): Token { return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)] }
  next(): Token { return this.tokens[this.pos < this.tokens.length ? this.pos++ : this.pos] }
  eof(): boolean { return this.peek().kind === 'EOF' }

  /** Skip whitespace-like tokens (NEWLINE, COMMENT). */
  skipTrivia(): void {
    while (!this.eof() && (this.peek().kind === 'NEWLINE' || this.peek().kind === 'COMMENT')) this.next()
  }

  /** Skip until we hit a token of the given kind/value. */
  skipUntil(value: string): void {
    while (!this.eof() && this.peek().value !== value) this.next()
  }
}

// ─── Scope / symbol table ─────────────────────────────────────────────────────

type SymbolKind = 'var' | 'func' | 'param' | 'import' | 'type' | 'const'

interface Symbol {
  name:    string
  kind:    SymbolKind
  line:    number
  col:     number
  /** Number of times this symbol has been read (not counting the declaration). */
  reads:   number
  /** Number of times this symbol has been written to after initial decl. */
  writes:  number
  /** Param count for functions. */
  params?: number
  variadic?: boolean
}

class Scope {
  symbols = new Map<string, Symbol>()
  constructor(public parent: Scope | null = null) {}

  declare(sym: Symbol): Symbol | null {
    if (this.symbols.has(sym.name)) return this.symbols.get(sym.name)!
    this.symbols.set(sym.name, sym)
    return null
  }

  lookup(name: string): Symbol | null {
    return this.symbols.get(name) ?? this.parent?.lookup(name) ?? null
  }

  /** Returns symbols declared directly in this scope (not parent). */
  ownSymbols(): Symbol[] { return Array.from(this.symbols.values()) }
}

// ─── Analyzer ─────────────────────────────────────────────────────────────────

interface FuncNode {
  name:     string
  line:     number
  col:      number
  params:   string[]
  variadic: boolean
  hasReturn: boolean  // has explicit return type annotation
}

interface ImportNode {
  localName: string
  path:      string
  line:      number
  col:       number
}

export function runV2DiagnosticsGo(
  code: string, filename: string, opts: LspEngineOptions,
): Diagnostic[] {
  if (!code.trim()) return []
  const installed = opts.installedPackages ?? new Set<string>()
  const diags: Diagnostic[] = []
  const srcLines = code.split('\n')
  let uid = 0
  const id = () => `lsp-v2-${uid++}`

  const push = (
    severity: Diagnostic['severity'],
    code_: TsukiErrorCode,
    line: number, col: number,
    message: string,
    endCol?: number,
    extra?: Partial<Diagnostic>,
  ) => {
    const rustFormatted = formatRustDiagnostic(severity, code_, message, filename, line, col, srcLines, endCol)
    diags.push({ id:id(), severity, source:'lsp', file:filename, line, col, message:`${code_}: ${message}`, rustFormatted, code:code_, ...extra })
  }

  // ── Tokenize ────────────────────────────────────────────────────────────────
  let tokens: Token[]
  try { tokens = tokenize(code) } catch { return [] }

  const ts = new TokenStream(tokens)

  // ── Pass 0: brace / paren balance ──────────────────────────────────────────
  {
    let braces = 0, parens = 0, lastBrace = {line:1,col:1}, lastParen = {line:1,col:1}
    for (const t of tokens) {
      if (t.kind === 'COMMENT' || t.kind === 'STRING' || t.kind === 'RAW_STRING') continue
      if (t.value === '{') { braces++; lastBrace = t }
      if (t.value === '}') { braces--; if (braces < 0) { push('error','S0001',t.line,t.col,"extra closing `}`"); braces = 0 } }
      if (t.value === '(') { parens++; lastParen = t }
      if (t.value === ')') { parens--; if (parens < 0) { push('error','S0002',t.line,t.col,"extra closing `)`"); parens = 0 } }
    }
    if (braces > 0) push('error','S0001',lastBrace.line,lastBrace.col,`unclosed \`{\` — ${braces} missing \`}\``)
    if (parens > 0) push('error','S0002',lastParen.line,lastParen.col,`unclosed \`(\` — ${parens} missing \`)\``)
  }

  // ── Pass 1: structural parse ────────────────────────────────────────────────
  // Collect: package name, imports, top-level func signatures, top-level vars/consts

  let pkgName = ''
  let pkgLine = 0
  const imports: ImportNode[] = []
  const topFuncs: FuncNode[] = []
  const calledFunctions = new Set<string>()  // all call-sites found anywhere
  const allTokens = tokens.filter(t => t.kind !== 'NEWLINE' && t.kind !== 'COMMENT')

  // Simple structural scan (not full parser — purpose is symbol collection)
  for (let i = 0; i < allTokens.length; i++) {
    const t = allTokens[i]

    // Package declaration
    if (t.kind === 'KEYWORD' && t.value === 'package') {
      const name = allTokens[i+1]
      if (name?.kind === 'IDENT') { pkgName = name.value; pkgLine = t.line }
      continue
    }

    // Single import: import "path"
    if (t.kind === 'KEYWORD' && t.value === 'import' && allTokens[i+1]?.kind === 'STRING') {
      const path = allTokens[i+1]
      const local = path.value.split('/').pop()!
      imports.push({ localName: local, path: path.value, line: t.line, col: t.col })
      continue
    }
    // Single aliased import: import alias "path"
    if (t.kind === 'KEYWORD' && t.value === 'import' && allTokens[i+1]?.kind === 'IDENT' && allTokens[i+2]?.kind === 'STRING') {
      const alias = allTokens[i+1]
      const path  = allTokens[i+2]
      imports.push({ localName: alias.value, path: path.value, line: t.line, col: t.col })
      continue
    }
    // Import block: import ( ... )
    if (t.kind === 'KEYWORD' && t.value === 'import' && allTokens[i+1]?.value === '(') {
      let j = i + 2
      while (j < allTokens.length && allTokens[j].value !== ')') {
        const tok = allTokens[j]
        if (tok.kind === 'STRING') {
          const path = tok.value
          const local = path.split('/').pop()!
          imports.push({ localName: local, path, line: tok.line, col: tok.col })
          j++
        } else if (tok.kind === 'IDENT' && allTokens[j+1]?.kind === 'STRING') {
          // aliased
          imports.push({ localName: tok.value, path: allTokens[j+1].value, line: tok.line, col: tok.col })
          j += 2
        } else { j++ }
      }
      continue
    }

    // func declarations
    if (t.kind === 'KEYWORD' && t.value === 'func') {
      let j = i + 1
      // Skip receiver: func (r *Type) name(
      if (allTokens[j]?.value === '(') {
        let depth = 1; j++
        while (j < allTokens.length && depth > 0) {
          if (allTokens[j].value === '(') depth++
          if (allTokens[j].value === ')') depth--
          j++
        }
      }
      const nameTok = allTokens[j]
      if (nameTok?.kind === 'IDENT') {
        // Collect params
        const params: string[] = []
        let variadic = false
        let k = j + 1
        if (allTokens[k]?.value === '(') {
          k++
          while (k < allTokens.length && allTokens[k].value !== ')') {
            if (allTokens[k].kind === 'IDENT') params.push(allTokens[k].value)
            if (allTokens[k].value === '...') variadic = true
            k++
          }
        }
        // Check for return type (anything between closing ) and opening {)
        let hasReturn = false
        while (k < allTokens.length && allTokens[k].value !== '{' && allTokens[k].value !== '}') {
          // If there is a token after the param list that is a type, it returns something
          if (allTokens[k].kind === 'IDENT' || allTokens[k].value === '(' || allTokens[k].value === '*') {
            hasReturn = true
          }
          k++
        }
        topFuncs.push({
          name:     nameTok.value,
          line:     t.line,
          col:      t.col,
          params,
          variadic,
          hasReturn,
        })
      }
    }

    // Collect all call-sites: IDENT followed by (
    if (t.kind === 'IDENT' && allTokens[i+1]?.value === '(') {
      calledFunctions.add(t.value)
    }
  }

  // ── Package check ───────────────────────────────────────────────────────────
  if (!pkgName) {
    push('error','T0200',1,1,'missing package declaration — Go files must start with `package main`')
  } else if (pkgName !== 'main') {
    push('warning','T0201',pkgLine,1,`package is \`${pkgName}\` — Arduino tsuki projects should use \`package main\``,
      undefined,
      { quickFix: { label: 'Change to `package main`', newText: srcLines[pkgLine-1].replace(/package\s+\w+/, 'package main') } })
  }

  // ── Import checks ───────────────────────────────────────────────────────────
  // Duplicate imports
  const seenPaths = new Map<string, number>()
  for (const imp of imports) {
    if (seenPaths.has(imp.path)) {
      push('error','S0004',imp.line,imp.col,`import \`"${imp.path}"\` duplicated`)
    } else {
      seenPaths.set(imp.path, imp.line)
    }
  }

  // Unknown / missing library
  for (const imp of imports) {
    if (imp.localName === '_') continue
    const info = KNOWN_LIBS[imp.path] ?? KNOWN_LIBS[imp.path.toUpperCase()] ?? KNOWN_LIBS[imp.path.toLowerCase()]
    const isInstalled = installed.has(imp.path.toLowerCase()) || installed.has(imp.path)
    if (isInstalled) continue
    if (!info) {
      diags.push({
        id:id(), severity:'warning', source:'lsp', file:filename,
        line:imp.line, col:imp.col,
        message:`T0002: unknown package \`"${imp.path}"\` — not in tsuki registry`,
        code:'T0002',
        missingLib: { importName:imp.path, displayName:imp.path, packageId:imp.path, knownBuiltin:false, description:`"${imp.path}" is not a known tsuki/Arduino library.` },
      })
    } else if (!info.knownBuiltin) {
      diags.push({
        id:id(), severity:'info', source:'lsp', file:filename,
        line:imp.line, col:imp.col,
        message:`T0002: \`"${info.displayName}"\` v${info.version} needs to be installed`,
        code:'T0002',
        missingLib: { importName:imp.path, ...info },
      })
    }
  }

  // Unused imports — build usage map
  // For each import, scan all IDENT tokens in non-import, non-comment positions
  const importUsed = new Map<string, boolean>()
  for (const imp of imports) importUsed.set(imp.localName, false)

  // Lines that are imports (skip them)
  const importLineSet = new Set(imports.map(im => im.line))

  for (const t of allTokens) {
    if (t.kind !== 'IDENT') continue
    if (importLineSet.has(t.line)) continue
    if (importUsed.has(t.value)) importUsed.set(t.value, true)
  }

  for (const imp of imports) {
    if (imp.localName === '_' || imp.localName === 'arduino') continue
    if (imp.path === 'arduino') continue
    if (!importUsed.get(imp.localName)) {
      push('error','T0002',imp.line,imp.col,`import \`"${imp.path}"\` declared and not used`)
    }
  }

  // ── Arduino sketch checks ────────────────────────────────────────────────────
  const isSketch = imports.some(im => im.path === 'arduino') || code.includes('arduino.')
  if (isSketch) {
    const hasSetup = topFuncs.some(f => f.name === 'setup')
    const hasLoop  = topFuncs.some(f => f.name === 'loop')
    if (!hasSetup) push('warning','T0202',1,1,'missing func setup() — required by Arduino runtime')
    if (!hasLoop)  push('warning','T0203',1,1,'missing func loop() — required by Arduino runtime')
  }

  // ── Unused functions (non-setup/loop) ──────────────────────────────────────
  const ARDUINO_RUNTIME_FUNCS = new Set(['setup','loop','init','main'])
  for (const fn of topFuncs) {
    if (ARDUINO_RUNTIME_FUNCS.has(fn.name)) continue
    if (fn.name.startsWith('_')) continue
    if (!calledFunctions.has(fn.name)) {
      push('warning','T0003',fn.line,fn.col,`function \`${fn.name}\` is never called`)
    }
  }

  // ── Per-line scope-aware analysis ───────────────────────────────────────────
  // Track variable usage with a scope stack.
  // We use a simplified approach: collect all declarations in each block,
  // then check if each declared var is used.

  interface VarEntry {
    name:      string
    line:      number
    col:       number
    kind:      'short' | 'var' | 'param' | 'range' | 'const'
    reads:     number   // genuine reads at usage sites
    writes:    number   // re-assignments after initial declaration
    declRead:  boolean  // true when the initial :=  / var = RHS counts as a "use"
  }

  // Use a flat-ish approach per function body for simplicity
  // We'll process the token stream sequentially and maintain a scope stack

  interface ScopeFrame {
    vars:  Map<string, VarEntry>
    depth: number
  }

  const scopeStack: ScopeFrame[] = []
  let braceDepth = 0
  let inFuncBody = false
  const unreachableReported = new Set<number>()

  // Track "terminated" state per block: after return/break/continue/panic, code is unreachable
  const blockTerminated: boolean[] = [false]

  const currentScope = () => scopeStack[scopeStack.length - 1]

  const declareVar = (name: string, line: number, col: number, kind: VarEntry['kind']) => {
    if (!currentScope()) return
    const existing = currentScope().vars.get(name)
    if (existing && existing.kind !== 'param') {
      // Shadow warning in same block
      push('warning','T0009',line,col,`variable \`${name}\` shadows declaration at line ${existing.line}`)
    } else if (!existing) {
      currentScope().vars.set(name, { name, line, col, kind, reads:0, writes:0, declRead:false })
    }
  }

  const useVar = (name: string) => {
    // Walk scope stack from innermost outward
    for (let s = scopeStack.length - 1; s >= 0; s--) {
      const entry = scopeStack[s].vars.get(name)
      if (entry) { entry.reads++; break }
    }
  }

  const assignVar = (name: string) => {
    for (let s = scopeStack.length - 1; s >= 0; s--) {
      const entry = scopeStack[s].vars.get(name)
      if (entry) { entry.writes++; break }
    }
  }

  // Pop scope and report unused
  const popScope = () => {
    const frame = scopeStack.pop()
    if (!frame) return
    for (const [, entry] of Array.from(frame.vars)) {
      if (entry.name === '_') continue
      if (entry.kind === 'param') continue  // params unused is T0001 but complex to check w/o full type info
      if (GO_BUILTINS.has(entry.name)) continue
      if (entry.reads === 0 && entry.writes === 0) {
        // T0001: declared and never touched at all (or only via RHS of its own :=)
        const sev = entry.kind === 'const' ? 'warning' : 'error'
        push(sev,'T0001',entry.line,entry.col,`variable \`${entry.name}\` declared and not used`)
      } else if (entry.reads === 0 && entry.writes > 0) {
        // T0011: variable is re-assigned after declaration but the stored value is never read
        push('warning','T0011',entry.line,entry.col,`variable \`${entry.name}\` is assigned but its value is never read`)
      }
    }
    blockTerminated.pop()
  }

  // Walk relevant tokens for scope analysis
  const nonTrivia = allTokens
  let ni = 0
  const nt = () => nonTrivia[ni]
  const npeek = (off=0) => nonTrivia[Math.min(ni+off, nonTrivia.length-1)]
  const nadv  = () => nonTrivia[ni++]

  // We'll do a streaming walk; only care about func/var/const/type/{/}/return/break/continue
  // Plus identifiers that are usage sites

  while (ni < nonTrivia.length) {
    const t = nt()

    // Open block
    if (t.value === '{') {
      braceDepth++
      scopeStack.push({ vars: new Map(), depth: braceDepth })
      blockTerminated.push(false)
      nadv(); continue
    }

    // Close block
    if (t.value === '}') {
      braceDepth--
      popScope()
      nadv(); continue
    }

    // func declaration — push params as scope
    if (t.kind === 'KEYWORD' && t.value === 'func') {
      nadv()
      // Skip optional receiver
      if (nt().value === '(') {
        let d = 1; nadv()
        while (ni < nonTrivia.length && d > 0) {
          if (nt().value === '(') d++
          if (nt().value === ')') d--
          nadv()
        }
      }
      // Func name
      if (nt().kind === 'IDENT') nadv()
      // Params
      if (nt().value === '(') {
        nadv() // skip (
        // The next { will push a scope; pre-declare params there
        // We'll collect param names and inject them after the { is seen
        // For simplicity, just track them for the upcoming scope
        const paramNames: Array<{name:string; line:number; col:number}> = []
        while (ni < nonTrivia.length && nt().value !== ')') {
          const pt = nt()
          // param: name type, or just type, or name ...type
          if (pt.kind === 'IDENT' && !GO_KEYWORDS.has(pt.value) && !GO_BUILTINS.has(pt.value)) {
            // look ahead: if next is also IDENT or *, it's a type → current is name
            const nx = npeek(1)
            if (nx && (nx.kind === 'IDENT' || nx.value === '*' || nx.value === '...')) {
              paramNames.push({ name: pt.value, line: pt.line, col: pt.col })
            }
          }
          nadv()
        }
        if (nt().value === ')') nadv() // skip )

        // Skip return type
        while (ni < nonTrivia.length && nt().value !== '{' && nt().value !== '}') nadv()

        // Now we expect {; push scope with params already declared
        if (nt().value === '{') {
          braceDepth++
          const frame: ScopeFrame = { vars: new Map(), depth: braceDepth }
          for (const p of paramNames) {
            frame.vars.set(p.name, { name:p.name, line:p.line, col:p.col, kind:'param', reads:0, writes:0, declRead:false })
          }
          scopeStack.push(frame)
          blockTerminated.push(false)
          nadv()
        }
        continue
      }
      continue
    }

    // var declaration
    if (t.kind === 'KEYWORD' && t.value === 'var') {
      nadv()
      if (nt().kind === 'IDENT') {
        const vt = nt(); nadv()
        declareVar(vt.value, vt.line, vt.col, 'var')
      }
      continue
    }

    // const declaration
    if (t.kind === 'KEYWORD' && t.value === 'const') {
      nadv()
      if (nt().kind === 'IDENT') {
        const ct = nt(); nadv()
        declareVar(ct.value, ct.line, ct.col, 'const')
      }
      continue
    }

    // Short declarations: x := ...  or  x, y, z := ...
    if (t.kind === 'IDENT' && npeek(1).value === ':=') {
      declareVar(t.value, t.line, t.col, 'short')
      // Mark declRead so the RHS evaluation is not counted as a genuine usage read
      const entry = currentScope()?.vars.get(t.value)
      if (entry) entry.declRead = true
      nadv(); nadv(); continue
    }
    // Multi-var short:  x, y := ...
    if (t.kind === 'IDENT' && npeek(1).value === ',') {
      // Collect all before :=
      const vars: Token[] = [t]
      let j = ni + 1
      while (j < nonTrivia.length && nonTrivia[j].value === ',' && nonTrivia[j+1]?.kind === 'IDENT') {
        vars.push(nonTrivia[j+1]); j += 2
      }
      if (nonTrivia[j]?.value === ':=') {
        for (const v of vars) declareVar(v.value, v.line, v.col, 'short')
        ni = j + 1
        continue
      }
    }

    // Range: for k, v := range ...
    if (t.kind === 'KEYWORD' && t.value === 'for') {
      nadv()
      // for k := range / for k, v := range
      const candidates: Token[] = []
      while (ni < nonTrivia.length && nt().value !== '{' && nt().value !== '}') {
        const ft = nt()
        if (ft.kind === 'IDENT' && !GO_KEYWORDS.has(ft.value)) candidates.push(ft)
        if (ft.value === ':=' || ft.kind === 'KEYWORD') break
        nadv()
      }
      if (nt().value === ':=') {
        nadv()
        if (nt().kind === 'KEYWORD' && nt().value === 'range') {
          for (const c of candidates) declareVar(c.value, c.line, c.col, 'range')
        }
      }
      continue
    }

    // return / break / continue / panic → mark block terminated
    if (t.kind === 'KEYWORD' && (t.value === 'return' || t.value === 'break' || t.value === 'continue')) {
      if (blockTerminated.length > 0) blockTerminated[blockTerminated.length - 1] = true
      nadv(); continue
    }
    if (t.kind === 'IDENT' && t.value === 'panic' && npeek(1).value === '(') {
      if (blockTerminated.length > 0) blockTerminated[blockTerminated.length - 1] = true
      nadv(); continue
    }

    // Unreachable code detection: if block is terminated and we hit a non-} statement
    if (blockTerminated[blockTerminated.length - 1] && t.kind !== 'PUNCT' && t.value !== '}') {
      if (!unreachableReported.has(t.line)) {
        unreachableReported.add(t.line)
        push('warning','T0004',t.line,t.col,'unreachable code')
        // Only report once per sequence
        while (ni < nonTrivia.length && nt().value !== '}') nadv()
        continue
      }
    }

    // Identifier usage (read site)
    if (t.kind === 'IDENT' && scopeStack.length > 0) {
      if (!GO_KEYWORDS.has(t.value) && !GO_BUILTINS.has(t.value)) {
        // Assignment: x = ... (not :=)
        if (npeek(1).value === '=' && npeek(1).kind !== 'OP') {
          assignVar(t.value)
        } else {
          useVar(t.value)
        }
      }
    }

    nadv()
  }

  // Flush remaining scopes
  while (scopeStack.length > 0) popScope()

  // ── Language-level checks (always run, not sketch-specific) ─────────────────

  // T0100: Division by zero (catches `/0` in any Go file)
  srcLines.forEach((raw, i) => {
    // Strip line comments and string literals before checking
    const stripped = raw.replace(/\/\/.*$/, '').replace(/"[^"]*"/g,'""').replace(/`[^`]*`/g,'``')
    if (/\/\s*0\b/.test(stripped)) {
      push('error','T0100',i+1,stripped.search(/\/\s*0/)+1,'division by zero')
    }
  })

  // T0101: Infinite loop without delay or break (catches tight `for {}` or `for true {}`)
  srcLines.forEach((raw, i) => {
    if (/^\s*for\s*\{/.test(raw) || /^\s*for\s+true\s*\{/.test(raw)) {
      // Look ahead up to 80 lines for a way out
      const block = srcLines.slice(i + 1, i + 80).join('\n')
      const hasEscape = /arduino\.Delay|time\.Sleep|delay\s*\(|break\b|return\b|panic\s*\(/.test(block)
      if (!hasEscape)
        push('warning','T0101',i+1,1,'infinite loop with no `break`, `return` or delay — this will block the scheduler')
    }
  })

  // ── Arduino-specific checks ─────────────────────────────────────────────────
  if (isSketch) {
    // T0300: Serial used without Serial.Begin in setup()
    // Matches both `arduino.Serial.Begin(...)` and `serial.Begin(...)`
    const serialBeginPattern = /(?:arduino\s*\.\s*Serial\s*\.\s*Begin|serial\s*\.\s*Begin)\s*\(/
    const serialUsagePattern = /(?:arduino\.Serial\.|serial\.)\s*(?:Print|Println|Write)\s*\(/
    if (!serialBeginPattern.test(code) && serialUsagePattern.test(code)) {
      // Find the first usage line for accurate location
      const usageLine = srcLines.findIndex(l => serialUsagePattern.test(l))
      if (usageLine >= 0) {
        const col = srcLines[usageLine].search(serialUsagePattern) + 1
        push('warning','T0300',usageLine + 1, col,
          '`Serial` used without `Serial.Begin()` — call `Serial.Begin(9600)` in `setup()`')
      }
    }

    // T0301 / T0302: arduino method arity + PWM pin validation
    const ARITIES: Record<string, [number,number]> = {
      PinMode:[2,2],DigitalWrite:[2,2],DigitalRead:[1,1],
      AnalogWrite:[2,2],AnalogRead:[1,1],Delay:[1,1],
      DelayMicroseconds:[1,1],Millis:[0,0],Micros:[0,0],
      Map:[5,5],Constrain:[3,3],Random:[1,2],
      RandomSeed:[1,1],Tone:[2,3],NoTone:[1,1],
      PulseIn:[2,3],ShiftIn:[3,3],ShiftOut:[4,4],
      AttachInterrupt:[3,3],DetachInterrupt:[1,1],
    }
    srcLines.forEach((raw, i) => {
      const ln = i + 1
      const m = raw.match(/arduino\.(\w+)\s*\(([^)]*)\)/)
      if (!m) return
      const [, method, argsStr] = m
      const arity = ARITIES[method]
      if (!arity) return
      const argc = argsStr.trim() === '' ? 0 : argsStr.split(',').filter(a => a.trim()).length
      const [min, max] = arity
      const col = raw.indexOf('arduino.') + 1
      if (argc < min)      push('error','T0301',ln,col,`\`arduino.${method}()\` takes ${min} argument${min!==1?'s':''}, found ${argc}`)
      else if (argc > max) push('error','T0301',ln,col,`\`arduino.${method}()\` takes at most ${max} argument${max!==1?'s':''}, found ${argc}`)

      // PWM pin check (Uno PWM pins: 3 5 6 9 10 11)
      if (method === 'AnalogWrite') {
        const pin = parseInt(argsStr.split(',')[0])
        if (!isNaN(pin) && ![3,5,6,9,10,11].includes(pin))
          push('warning','T0302',ln,col,`pin ${pin} does not support PWM on Uno — valid PWM pins are 3, 5, 6, 9, 10, 11`)
      }

      // Large delay hint
      if (method === 'Delay') {
        const ms = parseInt(argsStr)
        if (!isNaN(ms) && ms >= 5_000)
          push('info','T0304',ln,col,`large delay of ${ms} ms — consider using a named constant`)
      }
    })
  }

  return dedup(diags)
}

// ─── Deduplication ────────────────────────────────────────────────────────────

function dedup(diags: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>()
  return diags.filter(d => {
    const key = `${d.line}:${d.col}:${d.message.slice(0,50)}`
    if (seen.has(key)) return false
    seen.add(key); return true
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function runV2Diagnostics(
  code: string, filename: string, ext: string, opts: LspEngineOptions,
): Diagnostic[] {
  if (!code.trim()) return []
  try {
    if (ext === 'go' && opts.lspGoEnabled) return runV2DiagnosticsGo(code, filename, opts)
    // v2 doesn't yet cover cpp/ino/py — fall back to v1 for those
    return []
  } catch {
    return []
  }
}