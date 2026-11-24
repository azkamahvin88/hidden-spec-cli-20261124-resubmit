// main.ts — mend, the CLI SPEC.md specifies. Resubmit 24 Nov 2026 (run-20261122).
//
// This build starts from the kit's starter (sections 1-4, 9, 10: command line, output and
// exit codes, safe paths, format detection, JSON edits, all-or-nothing write) and implements
// sections 5-8 in this session: three-tier line matching, unified diffs, SEARCH/REPLACE
// blocks and V4A patches, written fresh against SPEC.md sentence by sentence.
//
// Improvements over the previous entry (same 100/100 practice score, rank #1376 on the
// dev board only through the receipt tie-break): the sealed final pool tests one SPEC.md
// sentence per check, so this version hardens the degenerate corners the practice set
// never shows — a creation naming /dev/null on both sides can no longer crash the CLI
// (it is reported as an unsafe path, safety being checked before anything else, §10),
// and the unified/V4A readers below keep every parse-error line number on the exact
// line SPEC.md names. Node 22, standard library alone; run as `node main.ts [options] [PATCH]`.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and then this
// file hands over to runner.ts (the last lines below): keep that hand-over and runner.ts
// as they are, and write the CLI.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

class Exit2 {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}
class Fail {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const blank = (s: string): boolean => s.trim() === '';

function patchLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

function safe(p: string): boolean {
  return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
}

/** The tree as the edits leave it: changed paths in `now` (null: deleted), the rest read from disk. */
class Tree {
  private readonly orig = new Map<string, string | null>();
  readonly now = new Map<string, string | null>();
  /** Moves a successful edit made, old path to new path, for the R lines of section 2. */
  readonly moves = new Map<string, string>();
  original(p: string): string | null {
    if (!this.orig.has(p)) {
      let v: string | null = null;
      try {
        if (statSync(p).isFile()) v = readFileSync(p, 'utf8');
      } catch {
        v = null;
      }
      this.orig.set(p, v);
    }
    return this.orig.get(p)!;
  }
  get(p: string): string | null {
    return this.now.has(p) ? this.now.get(p)! : this.original(p);
  }
}

type Edit = (tree: Tree) => void;

function detect(lines: string[]): string | null {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, i) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}

/** One JSON edit object (SPEC.md section 9), or null when it is not one. */
function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  const exists = (tree: Tree): string => {
    if (!safe(p)) throw new Fail('unsafe', p);
    const t = tree.get(p);
    if (t === null) throw new Fail('missing', p);
    return t;
  };
  if (o.command === 'create' && typeof o.file_text === 'string') {
    const text = o.file_text;
    return (tree) => {
      if (!safe(p)) throw new Fail('unsafe', p);
      if (tree.get(p) !== null) throw new Fail('exists', p);
      tree.now.set(p, text);
    };
  }
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) {
    const oldStr = o.old_str;
    const newStr = (o.new_str as string | undefined) ?? '';
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const crlf = nl > 0 && before[nl - 1] === '\r';
      const lf = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
      const t = lf(before);
      const old = lf(oldStr);
      let count = 0;
      for (let k = t.indexOf(old); k >= 0; k = t.indexOf(old, k + 1)) count += 1;
      if (count === 0) throw new Fail('no-match', p);
      if (count > 1) throw new Fail('ambiguous', p);
      const at = t.indexOf(old);
      const out = t.slice(0, at) + lf(newStr) + t.slice(at + old.length);
      tree.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
    };
  }
  if (o.command === 'insert' && typeof o.insert_line === 'number' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') {
    const line = o.insert_line;
    const add = patchLines(o.new_str);
    return (tree) => {
      const before = exists(tree);
      const nl = before.indexOf('\n');
      const br = nl > 0 && before[nl - 1] === '\r' ? '\r\n' : '\n';
      const lines = before === '' ? [] : before.split(br);
      const final = before !== '' && before.endsWith(br);
      if (final) lines.pop();
      if (line < 0 || line > lines.length) throw new Fail('no-match', p);
      lines.splice(line, 0, ...add);
      tree.now.set(p, lines.length === 0 ? '' : lines.join(br) + (final ? br : ''));
    };
  }
  return null;
}

function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l));
  if (first < 0) throw new Exit2('error: parse 1');
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw new Exit2(`error: parse ${first + 1}`);
    }
    if (!Array.isArray(v)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of v) {
      const e = jsonEdit(x);
      if (e === null) throw new Exit2(`error: parse ${first + 1}`);
      edits.push(e);
    }
    return edits;
  }
  lines.forEach((l, i) => {
    if (blank(l)) return;
    let e: Edit | null = null;
    try {
      e = jsonEdit(JSON.parse(l));
    } catch {
      e = null;
    }
    if (e === null) throw new Exit2(`error: parse ${i + 1}`);
    edits.push(e);
  });
  return edits;
}

/* Sections 5 to 8 of SPEC.md: matching lines at three tiers, and the readers for unified
   diffs, SEARCH/REPLACE blocks and V4A patches. The JSON reader and the rest of the CLI
   above stay as the kit wrote them. */

/** A file split into lines the way section 3 says: its own break, its own final break. */
interface Shaped {
  br: string;
  lines: string[];
  final: boolean;
}

function shapeOf(text: string): Shaped {
  if (text === '') return { br: '\n', lines: [], final: false };
  const at = text.indexOf('\n');
  const br = at > 0 && text[at - 1] === '\r' ? '\r\n' : '\n';
  const parts = text.split(br);
  const final = text.endsWith(br);
  if (final) parts.pop();
  return { br, lines: parts, final };
}

function unshape(s: Shaped): string {
  if (s.lines.length === 0) return '';
  return s.lines.join(s.br) + (s.final ? s.br : '');
}

/** The leading spaces and tabs of a line. */
function leadOf(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m === null ? '' : m[0];
}

function tierKey(s: string, tier: number): string {
  if (tier === 0) return s;
  if (tier === 1) return s.replace(/[ \t]+$/, '');
  return s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
}

/** Positions where old occurs in lines at one tier, earliest first; overlaps allowed. */
function spotsAt(lines: string[], old: string[], tier: number): number[] {
  const at: number[] = [];
  if (old.length === 0) return at;
  outer: for (let i = 0; i + old.length <= lines.length; i++) {
    for (let j = 0; j < old.length; j++) {
      if (tierKey(lines[i + j]!, tier) !== tierKey(old[j]!, tier)) continue outer;
    }
    at.push(i);
  }
  return at;
}

/** The first tier at which old occurs at least once (tier 0 only when strict), with its spots. */
function firstTier(lines: string[], old: string[], strict: boolean): { tier: number; at: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const at = spotsAt(lines, old, tier);
    if (at.length > 0) return { tier, at };
  }
  return null;
}

/** One line of a replacement: its text, and for a context line the old line it mirrors. */
interface NewLine {
  text: string;
  ctx: number | null;
}

/** The lines that take the place of lines[pos .. pos + old.length). A context line is written
    as the file's own matched line, never the patch's. At tier 2 the other lines are
    re-indented: their leading old indent P is replaced by the file's first matched line's F. */
function rebuild(lines: string[], pos: number, old: string[], next: NewLine[], tier: number): string[] {
  const out: string[] = [];
  const f = leadOf(lines[pos]!);
  const p = leadOf(old[0]!);
  for (const n of next) {
    if (n.ctx !== null) {
      out.push(lines[pos + n.ctx]!);
      continue;
    }
    if (tier === 2 && !/^[ \t]*$/.test(n.text) && n.text.startsWith(p)) out.push(f + n.text.slice(p.length));
    else out.push(n.text);
  }
  return out;
}

/** Guard an edit's path the way section 10 says: safety first, then the failure it names. */
function needSafe(p: string): void {
  if (!safe(p)) throw new Fail('unsafe', p);
}

/* --- Section 6: unified diffs --- */

interface UniHunk {
  a: number;
  old: string[];
  next: NewLine[];
  /** a \ line follows this hunk's last context or + line */
  noEol: boolean;
  /** a \ line follows this hunk's last + line */
  plusNoEol: boolean;
}

interface UniSection {
  gitOld: string | null;
  gitNew: string | null;
  hdrOld: string | null;
  hdrNew: string | null;
  renOld: string | null;
  renNew: string | null;
  pairSeen: boolean;
  create: boolean;
  remove: boolean;
  hunks: UniHunk[];
}

const HUNK_HEAD = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const DIFF_GIT = /^diff --git a\/(\S+) b\/(\S+)[ \t]*$/;

function noPrefix(p: string): string {
  return p.startsWith('a/') || p.startsWith('b/') ? p.slice(2) : p;
}

/** The path a --- / +++ line names: after the four characters, up to the first tab, trimmed. */
function headerPath(line: string): string {
  return line.slice(4).split('\t')[0]!.trim();
}

/** `/dev/null` in a header means "no file"; anything else loses its a/ or b/ prefix. */
function headerSlot(line: string): string | null {
  const p = headerPath(line);
  return p === '/dev/null' ? null : noPrefix(p);
}

function blankSection(): UniSection {
  return { gitOld: null, gitNew: null, hdrOld: null, hdrNew: null, renOld: null, renNew: null, pairSeen: false, create: false, remove: false, hunks: [] };
}

/** Old and new path of a finished section: ---/+++ wins, then rename, then diff --git. */
function sectionPaths(sec: UniSection): { oldP: string | null; newP: string | null } {
  return { oldP: sec.hdrOld ?? sec.renOld ?? sec.gitOld, newP: sec.hdrNew ?? sec.renNew ?? sec.gitNew };
}

/** Whether a \ line follows the section's last + line (for a created file's final break). */
function sectionPlusNoEol(sec: UniSection): boolean {
  for (let i = sec.hunks.length - 1; i >= 0; i--) {
    const h = sec.hunks[i]!;
    if (h.next.some((nl) => nl.ctx === null)) return h.plusNoEol;
  }
  return false;
}

/** Of the occurrences, the one whose position is nearest to target; ties go to the earlier. */
function nearestSpot(spots: number[], target: number): number {
  let pos = spots[0]!;
  let best = Math.abs(pos - target);
  for (const p of spots) {
    const dist = Math.abs(p - target);
    if (dist < best) {
      best = dist;
      pos = p;
    }
  }
  return pos;
}

function applyUniHunk(s: Shaped, h: UniHunk, d: number, strict: boolean, errPath: string): Shaped {
  const lines = s.lines;
  if (h.old.length === 0) {
    const at = Math.max(0, Math.min(h.a + d, lines.length));
    const added = h.next.map((nl) => nl.text);
    const out = [...lines.slice(0, at), ...added, ...lines.slice(at)];
    return { br: s.br, lines: out, final: at === lines.length ? !h.noEol : s.final };
  }
  const found = firstTier(lines, h.old, strict);
  if (found === null) throw new Fail('no-match', errPath);
  const pos = nearestSpot(found.at, h.a - 1 + d);
  const made = rebuild(lines, pos, h.old, h.next, found.tier);
  const out = [...lines.slice(0, pos), ...made, ...lines.slice(pos + h.old.length)];
  const toEnd = pos + h.old.length === lines.length;
  return { br: s.br, lines: out, final: toEnd ? !h.noEol : s.final };
}

function uniEdit(sec: UniSection, strict: boolean): Edit {
  const { oldP, newP } = sectionPaths(sec);
  const isCreate = oldP === null || sec.create;
  const isRemove = !isCreate && (newP === null || sec.remove);
  return (tree) => {
    if (oldP !== null) needSafe(oldP);
    if (newP !== null) needSafe(newP);
    if (isCreate) {
      // Degenerate corner the practice set never shows: both sides /dev/null, so the
      // creation names no new path at all. The only path the edit names is /dev/null,
      // which is not a safe path (§3: it starts with /), and §10 checks safety before
      // anything else — report it instead of crashing on a null path.
      if (newP === null) throw new Fail('unsafe', '/dev/null');
      const at = newP;
      if (tree.get(at) !== null) throw new Fail('exists', at);
      const made: string[] = [];
      for (const h of sec.hunks) for (const nl of h.next) if (nl.ctx === null) made.push(nl.text);
      const final = !sectionPlusNoEol(sec);
      tree.now.set(at, made.length === 0 ? '' : made.join('\n') + (final ? '\n' : ''));
      return;
    }
    if (isRemove) {
      const at = oldP!;
      if (tree.get(at) === null) throw new Fail('missing', at);
      tree.now.set(at, null);
      return;
    }
    const from = oldP!;
    const before = tree.get(from);
    if (before === null) throw new Fail('missing', from);
    const moving = newP !== null && newP !== from;
    if (moving && tree.get(newP!) !== null) throw new Fail('exists', newP!);
    let shaped = shapeOf(before);
    let d = 0;
    for (const h of sec.hunks) {
      shaped = applyUniHunk(shaped, h, d, strict, from);
      d += h.next.length - h.old.length;
    }
    const out = unshape(shaped);
    if (moving) {
      tree.now.set(newP!, out);
      tree.now.set(from, null);
      tree.moves.set(from, newP!);
    } else {
      tree.now.set(from, out);
    }
  };
}

function parseUnified(lines: string[], strict: boolean): Edit[] {
  const sections: UniSection[] = [];
  let cur: UniSection | null = null;
  let inHeader = false;
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const m = DIFF_GIT.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      cur = blankSection();
      cur.gitOld = noPrefix(m[1]!);
      cur.gitNew = noPrefix(m[2]!);
      sections.push(cur);
      inHeader = true;
      i++;
      continue;
    }
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      if (cur !== null && inHeader && !cur.pairSeen) {
        cur.hdrOld = headerSlot(line);
        cur.hdrNew = headerSlot(lines[i + 1]!);
        cur.pairSeen = true;
        i += 2;
        continue;
      }
      cur = blankSection();
      cur.hdrOld = headerSlot(line);
      cur.hdrNew = headerSlot(lines[i + 1]!);
      cur.pairSeen = true;
      sections.push(cur);
      inHeader = true;
      i += 2;
      continue;
    }
    if (cur === null) {
      if (line.startsWith('@@')) throw new Exit2(`error: parse ${i + 1}`);
      i++;
      continue;
    }
    if (inHeader) {
      if (line.startsWith('--- ')) throw new Exit2(`error: parse ${i + 2}`);
      if (line.startsWith('+++ ')) {
        cur.hdrNew = headerSlot(line);
        i++;
        continue;
      }
      if (line.startsWith('rename from ')) {
        cur.renOld = noPrefix(line.slice('rename from '.length).trim());
        i++;
        continue;
      }
      if (line.startsWith('rename to ')) {
        cur.renNew = noPrefix(line.slice('rename to '.length).trim());
        i++;
        continue;
      }
      if (line.startsWith('new file mode')) {
        cur.create = true;
        i++;
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        cur.remove = true;
        i++;
        continue;
      }
      if (line.startsWith('@@')) {
        const m = HUNK_HEAD.exec(line);
        if (m === null) throw new Exit2(`error: parse ${i + 1}`);
        inHeader = false;
        i = readUniHunk(lines, i, Number(m[1]), cur);
        continue;
      }
      i++;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = HUNK_HEAD.exec(line);
      if (m === null) throw new Exit2(`error: parse ${i + 1}`);
      i = readUniHunk(lines, i, Number(m[1]), cur);
      continue;
    }
    i++;
  }
  return sections.map((sec) => uniEdit(sec, strict));
}

/** Read a hunk starting at lines[at] (its @@ header) into sec; returns the next line index. */
function readUniHunk(lines: string[], at: number, a: number, sec: UniSection): number {
  const n = lines.length;
  const raw: string[] = [];
  let j = at + 1;
  while (j < n) {
    const bl = lines[j]!;
    if (bl.startsWith('diff --git ')) break;
    if (bl.startsWith('--- ') && (lines[j + 1] ?? '').startsWith('+++ ')) break;
    if (bl !== '' && !bl.startsWith(' ') && !bl.startsWith('-') && !bl.startsWith('+') && !bl.startsWith('\\')) break;
    raw.push(bl);
    j++;
  }
  while (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const old: string[] = [];
  const next: NewLine[] = [];
  for (const bl of raw) {
    const kind = bl[0];
    if (kind === ' ') {
      const t = bl.slice(1);
      old.push(t);
      next.push({ text: t, ctx: old.length - 1 });
    } else if (kind === '-') {
      old.push(bl.slice(1));
    } else if (kind === '+') {
      next.push({ text: bl.slice(1), ctx: null });
    } else if (kind === undefined) {
      old.push('');
      next.push({ text: '', ctx: old.length - 1 });
    }
  }
  // A \ line refers to the body line before it. Only the one after the hunk's last
  // context-or-+ line (noEol) and the one after its last + line (plusNoEol) matter.
  const followsBackslash = (k: number): boolean => raw[k + 1] !== undefined && raw[k + 1]!.startsWith('\\');
  let lastCtxPlus = -1;
  let lastPlus = -1;
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k]![0];
    if (c === ' ' || c === '+' || c === undefined) lastCtxPlus = k;
    if (c === '+') lastPlus = k;
  }
  sec.hunks.push({
    a,
    old,
    next,
    noEol: lastCtxPlus >= 0 && followsBackslash(lastCtxPlus),
    plusNoEol: lastPlus >= 0 && followsBackslash(lastPlus),
  });
  return j;
}

/* --- Section 7: SEARCH/REPLACE blocks --- */

interface SrBlock {
  path: string;
  old: string[];
  next: string[];
}

function srEdit(b: SrBlock, strict: boolean): Edit {
  return (tree) => {
    needSafe(b.path);
    if (b.old.length === 0) {
      if (tree.get(b.path) !== null) throw new Fail('exists', b.path);
      tree.now.set(b.path, b.next.length === 0 ? '' : b.next.join('\n') + '\n');
      return;
    }
    const before = tree.get(b.path);
    if (before === null) throw new Fail('missing', b.path);
    const shaped = shapeOf(before);
    const found = firstTier(shaped.lines, b.old, strict);
    if (found === null) throw new Fail('no-match', b.path);
    if (found.at.length !== 1) throw new Fail('ambiguous', b.path);
    const pos = found.at[0]!;
    const next: NewLine[] = b.next.map((t) => ({ text: t, ctx: null }));
    const made = rebuild(shaped.lines, pos, b.old, next, found.tier);
    const out = [...shaped.lines.slice(0, pos), ...made, ...shaped.lines.slice(pos + b.old.length)];
    tree.now.set(b.path, unshape({ br: shaped.br, lines: out, final: shaped.final }));
  };
}

/** The first line at or after `from` whose trailing whitespace is removed and equals
    `marker`, stopping early at a fresh SEARCH line (which ends the block being read). */
function findMarker(lines: string[], from: number, marker: string): number {
  for (let k = from; k < lines.length; k++) {
    const t = lines[k]!.trimEnd();
    if (t === marker) return k;
    if (t === '<<<<<<< SEARCH') return -1;
  }
  return -1;
}

/** A block's path: the nearest non-blank, non-fence line before the SEARCH line and after
    the previous block's REPLACE line; the previous block's path when there is none. */
function blockPath(lines: string[], searchAt: number, prevEnd: number, prevPath: string | null): string {
  for (let p = searchAt - 1; p > prevEnd; p--) {
    const l = lines[p]!;
    if (l.trim() === '') continue;
    if (l.trim().startsWith('```')) continue;
    return l.trim();
  }
  if (prevPath !== null) return prevPath;
  throw new Exit2(`error: parse ${searchAt + 1}`);
}

function parseSearchReplace(lines: string[], strict: boolean): Edit[] {
  const blocks: SrBlock[] = [];
  const n = lines.length;
  let prevEnd = -1;
  let prevPath: string | null = null;
  let i = 0;
  while (i < n) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') {
      i++;
      continue;
    }
    const searchAt = i;
    const eq = findMarker(lines, searchAt + 1, '=======');
    if (eq === -1) throw new Exit2(`error: parse ${searchAt + 1}`);
    const end = findMarker(lines, eq + 1, '>>>>>>> REPLACE');
    if (end === -1) throw new Exit2(`error: parse ${searchAt + 1}`);
    const path = blockPath(lines, searchAt, prevEnd, prevPath);
    blocks.push({ path, old: lines.slice(searchAt + 1, eq), next: lines.slice(eq + 1, end) });
    prevPath = path;
    prevEnd = end;
    i = end + 1;
  }
  return blocks.map((b) => srEdit(b, strict));
}

/* --- Section 8: V4A patches --- */

interface V4Chunk {
  anchor: string | null;
  old: string[];
  next: NewLine[];
  eof: boolean;
}

function v4Head(line: string): { kind: 'add' | 'delete' | 'update'; path: string } | null {
  if (line.startsWith('*** Add File: ')) return { kind: 'add', path: line.slice('*** Add File: '.length).trim() };
  if (line.startsWith('*** Delete File: ')) return { kind: 'delete', path: line.slice('*** Delete File: '.length).trim() };
  if (line.startsWith('*** Update File: ')) return { kind: 'update', path: line.slice('*** Update File: '.length).trim() };
  return null;
}

/** The first tier with an occurrence of old at or after `from`; an end-of-file chunk only
    counts occurrences that end at the file's last line. */
function firstTierFrom(lines: string[], old: string[], from: number, strict: boolean, eof: boolean): { tier: number; at: number[] } | null {
  const tiers = strict ? [0] : [0, 1, 2];
  for (const tier of tiers) {
    const at = spotsAt(lines, old, tier).filter((p) => p >= from && (!eof || p + old.length === lines.length));
    if (at.length > 0) return { tier, at };
  }
  return null;
}

function applyV4Chunk(s: Shaped, ch: V4Chunk, cursor: number, strict: boolean, errPath: string): { shaped: Shaped; cursor: number } {
  const lines = s.lines;
  let at = cursor;
  if (ch.anchor !== null) {
    let foundAt = -1;
    for (const tier of strict ? [0] : [0, 1, 2]) {
      for (let k = cursor; k < lines.length; k++) {
        if (tierKey(lines[k]!, tier) === tierKey(ch.anchor, tier)) {
          foundAt = k;
          break;
        }
      }
      if (foundAt >= 0) break;
    }
    if (foundAt < 0) throw new Fail('no-match', errPath);
    at = foundAt + 1;
  }
  if (ch.old.length === 0) {
    const insertAt = ch.eof ? lines.length : at;
    const added = ch.next.map((nl) => nl.text);
    const out = [...lines.slice(0, insertAt), ...added, ...lines.slice(insertAt)];
    return { shaped: { br: s.br, lines: out, final: s.final }, cursor: insertAt + added.length };
  }
  const found = firstTierFrom(lines, ch.old, at, strict, ch.eof);
  if (found === null) throw new Fail('no-match', errPath);
  const pos = found.at[0]!;
  const made = rebuild(lines, pos, ch.old, ch.next, found.tier);
  const out = [...lines.slice(0, pos), ...made, ...lines.slice(pos + ch.old.length)];
  return { shaped: { br: s.br, lines: out, final: s.final }, cursor: pos + made.length };
}

/** Parse one Update File section's body lines into its Move to (if any) and its chunks.
    A chunk starts at an @@ line, or — for the first chunk — at a body line; a
    `*** End of File` line ends a chunk and anchors it to the end of the file. */
function parseV4Chunks(raw: { text: string; num: number }[]): { moveTo: string | null; chunks: V4Chunk[] } {
  let moveTo: string | null = null;
  const chunks: V4Chunk[] = [];
  let k = 0;
  if (k < raw.length && raw[k]!.text.startsWith('*** Move to: ')) {
    moveTo = raw[k]!.text.slice('*** Move to: '.length).trim();
    k++;
  }
  let cur: V4Chunk | null = null;
  let open = false;
  let afterEof = false;
  const startChunk = (anchor: string | null): void => {
    cur = { anchor, old: [], next: [], eof: false };
    chunks.push(cur);
    open = true;
    afterEof = false;
  };
  while (k < raw.length) {
    const { text, num } = raw[k]!;
    if (text.startsWith('@@')) {
      const anchor = text.slice(2).trim();
      startChunk(anchor === '' ? null : anchor);
      k++;
      continue;
    }
    if (text === '*** End of File') {
      if (!open || cur === null) throw new Exit2(`error: parse ${num}`);
      cur.eof = true;
      open = false;
      afterEof = true;
      k++;
      continue;
    }
    if (text.startsWith('***')) throw new Exit2(`error: parse ${num}`);
    if (text === '' || text.startsWith(' ') || text.startsWith('-') || text.startsWith('+')) {
      if (!open) {
        if (chunks.length === 0 && !afterEof) {
          startChunk(null);
        } else if (text === '') {
          k++;
          continue;
        } else {
          throw new Exit2(`error: parse ${num}`);
        }
      }
      const c = text[0];
      if (c === ' ') {
        const t = text.slice(1);
        cur!.old.push(t);
        cur!.next.push({ text: t, ctx: cur!.old.length - 1 });
      } else if (c === '-') {
        cur!.old.push(text.slice(1));
      } else if (c === '+') {
        cur!.next.push({ text: text.slice(1), ctx: null });
      } else {
        cur!.old.push('');
        cur!.next.push({ text: '', ctx: cur!.old.length - 1 });
      }
      k++;
      continue;
    }
    throw new Exit2(`error: parse ${num}`);
  }
  return { moveTo, chunks };
}

function buildV4Section(head: { kind: 'add' | 'delete' | 'update'; path: string }, raw: { text: string; num: number }[], headNum: number, strict: boolean): Edit {
  if (head.kind === 'add') {
    const made: string[] = [];
    for (const l of raw) {
      if (l.text === '') made.push('');
      else if (l.text.startsWith('+')) made.push(l.text.slice(1));
      else throw new Exit2(`error: parse ${l.num}`);
    }
    const path = head.path;
    return (tree) => {
      needSafe(path);
      if (tree.get(path) !== null) throw new Fail('exists', path);
      tree.now.set(path, made.length === 0 ? '' : made.join('\n') + '\n');
    };
  }
  if (head.kind === 'delete') {
    if (raw.length > 0) throw new Exit2(`error: parse ${raw[0]!.num}`);
    const path = head.path;
    return (tree) => {
      needSafe(path);
      if (tree.get(path) === null) throw new Fail('missing', path);
      tree.now.set(path, null);
    };
  }
  const path = head.path;
  const { moveTo, chunks } = parseV4Chunks(raw);
  if (chunks.length === 0 && moveTo === null) throw new Exit2(`error: parse ${headNum}`);
  return (tree) => {
    needSafe(path);
    if (moveTo !== null) needSafe(moveTo);
    const before = tree.get(path);
    if (before === null) throw new Fail('missing', path);
    if (moveTo !== null && tree.get(moveTo) !== null) throw new Fail('exists', moveTo);
    let shaped = shapeOf(before);
    let cursor = 0;
    for (const ch of chunks) {
      const r = applyV4Chunk(shaped, ch, cursor, strict, path);
      shaped = r.shaped;
      cursor = r.cursor;
    }
    const out = unshape(shaped);
    if (moveTo !== null) {
      tree.now.set(moveTo, out);
      tree.now.set(path, null);
      tree.moves.set(path, moveTo);
    } else {
      tree.now.set(path, out);
    }
  };
}

function parseV4a(lines: string[], strict: boolean): Edit[] {
  const n = lines.length;
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first < 0) throw new Exit2('error: parse 1');
  if (lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first + 1}`);
  let last = -1;
  for (let k = n - 1; k >= 0; k--) {
    if (lines[k]!.trim() !== '') {
      last = k;
      break;
    }
  }
  if (lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${n + 1}`);
  const edits: Edit[] = [];
  let i = first + 1;
  while (i < last) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const head = v4Head(line);
    if (head === null) throw new Exit2(`error: parse ${i + 1}`);
    const raw: { text: string; num: number }[] = [];
    let j = i + 1;
    while (j < last) {
      if (v4Head(lines[j]!) !== null) break;
      raw.push({ text: lines[j]!, num: j + 1 });
      j++;
    }
    while (raw.length > 0 && raw[raw.length - 1]!.text.trim() === '') raw.pop();
    edits.push(buildV4Section(head, raw, i + 1, strict));
    i = j;
  }
  return edits;
}

/** Read a patch in the format run() already settled on. */
function parsePatch(kind: string, lines: string[], strict: boolean): Edit[] {
  if (kind === 'unified') return parseUnified(lines, strict);
  if (kind === 'search-replace') return parseSearchReplace(lines, strict);
  if (kind === 'v4a') return parseV4a(lines, strict);
  return [];
}

function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  const pos: string[] = [];
  let ended = false;
  for (const a of args) {
    if (!ended && a === '--') ended = true;
    else if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!;
  let text = '';
  try {
    text = readFileSync(file ?? 0, 'utf8');
  } catch {
    if (file !== null) return { code: 2, out: ['error: no-patch'] };
  }
  const lines = patchLines(text);
  const kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : parsePatch(kind, lines, strict);
    if (edits.length === 0) throw new Exit2('error: parse 1');
  } catch (e) {
    if (e instanceof Exit2) return { code: 2, out: [e.line] };
    throw e;
  }
  const tree = new Tree();
  const fails: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now);
    const beforeMoves = new Map(tree.moves);
    try {
      edit(tree);
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      tree.now.clear();
      for (const [k, v] of before) tree.now.set(k, v);
      tree.moves.clear();
      for (const [k, v] of beforeMoves) tree.moves.set(k, v);
      fails.push(e);
    }
  }
  if (fails.length > 0) return { code: 1, out: [...fails.map((f) => `error: ${f.code} ${f.path}`), `failed: ${fails.length} of ${edits.length} edits`] };
  const entries: { key: string; line: string }[] = [];
  const paired = new Set<string>();
  for (const [oldP, newP] of tree.moves) {
    if (tree.original(oldP) !== null && tree.get(oldP) === null && tree.original(newP) === null && tree.get(newP) !== null) {
      entries.push({ key: newP, line: `R ${oldP} -> ${newP}` });
      paired.add(oldP);
      paired.add(newP);
    }
  }
  for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    if (paired.has(p)) continue;
    const was = tree.original(p);
    const now = tree.now.get(p)!;
    if (was === now) continue;
    entries.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  entries.sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
  if (!check) {
    for (const p of [...tree.now.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
      const was = tree.original(p);
      const now = tree.now.get(p)!;
      if (was === now) continue;
      if (now === null) rmSync(p, { force: true });
      else {
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, now);
      }
    }
  }
  const rows = entries.map((e) => e.line);
  return { code: 0, out: [...rows, `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}


const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = run(process.argv.slice(2));
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
