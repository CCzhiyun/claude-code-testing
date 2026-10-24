import { tuiTheme, wrapTerminal } from '../tui/presentation.js';
import { truncateTerminal } from '../ink.js';
import type {LocalGoalDialog} from './goalRunDialog.js';
import type {LocalConflictDialog} from './conflictDialog.js';

export interface AgentQuestion { id: string; question: string; choices: string[]; multiple: boolean }
export interface QuestionDialogState {
  type: 'question'; agentId: string; questions: AgentQuestion[]; index: number; selected: number;
  checked: number[]; answers: Record<string, string[]>; editing: boolean; input: string;
  /** Constructed only by the local human workflow UI, never parsed from Agent output. */
  localGoal?: LocalGoalDialog;
  localConflict?:LocalConflictDialog;
  questionScroll?: number;
}

export function createQuestionDialog(agentId: string, output: string, plain = false): QuestionDialogState | undefined {
  let questions: AgentQuestion[];
  try {
    const data = JSON.parse(output) as { type?: string; questions?: unknown[] };
    if (data.type !== 'questions' || !Array.isArray(data.questions) || !data.questions.length || data.questions.length > 4) return undefined;
    questions = data.questions.map((item) => {
      const q = item as Partial<AgentQuestion> | null;
      if (!q || typeof q.id !== 'string' || !q.id || typeof q.question !== 'string' || !q.question.trim()) throw new Error('Invalid question');
      if (q.choices !== undefined && (!Array.isArray(q.choices) || q.choices.some((choice) => typeof choice !== 'string'))) throw new Error('Invalid choices');
      return { id: q.id, question: q.question, choices: (q.choices ?? []).slice(0, 10), multiple: q.multiple === true };
    });
    if (new Set(questions.map((q) => q.id)).size !== questions.length) return undefined;
  } catch {
    if (!plain || !output.trim()) return undefined;
    questions = [{ id: 'answer', question: output, choices: [], multiple: false }];
  }
  return { type: 'question', agentId, questions, index: 0, selected: 0, checked: [], answers: {}, editing: !questions[0]!.choices.length, input: '' };
}

export function questionAnswer(dialog: QuestionDialogState): string {
  return JSON.stringify({ type: 'answers', answers: dialog.questions.map((q) => ({ id: q.id, question: q.question, answers: dialog.answers[q.id] ?? [] })) });
}

/** Pure key reducer: no default answer or external action on cancel. */
export function navigateQuestion(dialog: QuestionDialogState, key: string, text = '', ctrl = false): 'render' | 'cancel' | 'submit' {
  const q = dialog.questions[dialog.index]!;
  const custom = q.choices.length;
  if (ctrl && ['c', 'd'].includes(key)) return 'cancel';
  if((dialog.localGoal||dialog.localConflict)&&['pagedown','pageup'].includes(key)){dialog.questionScroll=Math.max(0,(dialog.questionScroll??0)+(key==='pagedown'?12:-12));return 'render';}
  if (key === 'escape') {
    if (dialog.editing && q.choices.length) { dialog.editing = false; return 'render'; }
    return 'cancel';
  }
  if (ctrl) return 'render';
  const accept = (answers: string[]): 'render' | 'submit' => {
    if (!answers.length) return 'render';
    dialog.answers[q.id] = answers;
    if (dialog.index === dialog.questions.length - 1) return 'submit';
    dialog.index++; dialog.selected = 0; dialog.checked = []; dialog.input = '';dialog.questionScroll=0;
    dialog.editing = !dialog.questions[dialog.index]!.choices.length;
    return 'render';
  };
  if (dialog.editing) {
    if (key === 'return') return dialog.input.trim() ? accept([...dialog.checked.map((i) => q.choices[i]!), dialog.input.trim()]) : 'render';
    if (key === 'backspace') dialog.input = Array.from(dialog.input).slice(0, -1).join('');
    else if (text && !/[\x00-\x1f\x7f]/.test(text)) dialog.input += text;
    return 'render';
  }
  const last = custom + (q.multiple ? 1 : 0);
  if (key === 'up') dialog.selected = (dialog.selected + last) % (last + 1);
  else if (key === 'down' || key === 'tab') dialog.selected = (dialog.selected + 1) % (last + 1);
  else if (/^[1-9]$/.test(text)) dialog.selected = Math.min(Number(text) - 1, last);
  else if ((key === 'space' || text === ' ') && q.multiple && dialog.selected < custom) {
    dialog.checked = dialog.checked.includes(dialog.selected) ? dialog.checked.filter((i) => i !== dialog.selected) : [...dialog.checked, dialog.selected];
  } else if (key === 'return') {
    if (dialog.selected === custom) dialog.editing = true;
    else if (q.multiple) {
      if (dialog.selected > custom) return accept(dialog.checked.map((i) => q.choices[i]!));
      dialog.checked = dialog.checked.includes(dialog.selected) ? dialog.checked.filter((i) => i !== dialog.selected) : [...dialog.checked, dialog.selected];
    } else return accept([q.choices[dialog.selected]!]);
  }
  return 'render';
}

export function renderQuestionDialog(dialog: QuestionDialogState, width: number, height: number): string[] {
  const q = dialog.questions[dialog.index]!;
  const line = (text: string) => truncateTerminal(text, Math.max(12, width - 2));
  const heading = `${tuiTheme.accent}${line(`Question ${dialog.index + 1}/${dialog.questions.length} · ${q.id.replace(/[\x00-\x1f\x7f]/g, '')}`)}${tuiTheme.reset}`;
  const body = wrapTerminal(q.question.replace(/[\x00-\x1f\x7f]/g, ' '), Math.max(12, width - 4));
  const local=dialog.localGoal||dialog.localConflict;
  const questionRoom=local?Math.max(2,height-9):Math.max(2,Math.floor(height/3));
  const offset=local?Math.min(dialog.questionScroll??0,Math.max(0,body.length-questionRoom)):0;
  const questionLines = body.slice(offset,offset+questionRoom);
  if (body.length > questionLines.length) questionLines[questionLines.length - 1] = `${questionLines.at(-1)}…`;
  const header = [heading, '', ...questionLines, ...(local?[line(`Review lines ${offset+1}–${Math.min(body.length,offset+questionRoom)}/${body.length} · PgUp/PgDn scroll · Esc cancel`)]:[]), ''];
  if (dialog.editing) return [...header, line(`Your answer > ${dialog.input}`), '', line('Enter submit answer · Esc back/cancel')].slice(0, height);
  const options = [...q.choices, 'Type your own answer', ...(q.multiple ? ['Submit selected answers'] : [])];
  const room = Math.max(1, height - header.length - 3);
  const start = Math.min(Math.max(0, dialog.selected - Math.floor(room / 2)), Math.max(0, options.length - room));
  const rows = options.slice(start, start + room).map((option, offset) => {
    const i = start + offset;
    const mark = q.multiple && i < q.choices.length ? (dialog.checked.includes(i) ? '[x] ' : '[ ] ') : '';
    return `${i === dialog.selected ? tuiTheme.selected : ''}${line(`${i === dialog.selected ? '>' : ' '} ${i + 1}. ${mark}${option.replace(/[\x00-\x1f\x7f]/g, ' ')}`)}${tuiTheme.reset}`;
  });
  return [...header, ...rows, '', line(`${dialog.selected + 1}/${options.length} · ↑/↓ select${q.multiple ? ' · Space toggle' : ''} · Enter confirm · Esc cancel`)];
}
