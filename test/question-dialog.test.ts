import { expect, test } from 'bun:test';
import { createQuestionDialog, navigateQuestion, questionAnswer, renderQuestionDialog } from '../src/components/questionDialog.js';

const payload = (multiple = false) => JSON.stringify({ type: 'questions', questions: [{ id: 'roles', question: 'Choose users', choices: ['Peers', 'Manager', 'HR'], multiple }] });
test('question navigation confirms explicitly; cancel sends no default answer', () => {
  const dialog = createQuestionDialog('agent', payload())!;
  expect(navigateQuestion(dialog, 'escape')).toBe('cancel');
  expect(dialog.answers).toEqual({});
  navigateQuestion(dialog, 'down');
  expect(navigateQuestion(dialog, 'return')).toBe('submit');
  expect(JSON.parse(questionAnswer(dialog)).answers[0].answers).toEqual(['Manager']);
});
test('multi-select and custom input retain values and reject empty submissions', () => {
  const dialog = createQuestionDialog('agent', payload(true))!;
  navigateQuestion(dialog, 'space', ' ');
  navigateQuestion(dialog, 'down'); navigateQuestion(dialog, 'space', ' ');
  navigateQuestion(dialog, '', '4'); navigateQuestion(dialog, 'return');
  expect(navigateQuestion(dialog, 'return')).toBe('render');
  navigateQuestion(dialog, '', '外部审批🙂'); navigateQuestion(dialog, 'backspace');
  expect(navigateQuestion(dialog, 'return')).toBe('submit');
  expect(dialog.answers.roles).toEqual(['Peers', 'Manager', '外部审批']);
});
test('multi-question answers advance independently and small terminals retain selection/footer', () => {
  const dialog = createQuestionDialog('a', JSON.stringify({ type: 'questions', questions: [{ id: 'a', question: 'First?', choices: ['Yes'] }, { id: 'b', question: 'Second?', choices: Array.from({ length: 10 }, (_, i) => `Option${i}`) }] }))!;
  expect(navigateQuestion(dialog, 'return')).toBe('render');
  for (let i = 0; i < 8; i++) navigateQuestion(dialog, 'down');
  const rendered = renderQuestionDialog(dialog, 50, 12);
  expect(rendered.length).toBeLessThanOrEqual(12);
  expect(rendered.join('\n')).toContain('Option8');
  expect(rendered.join('\n')).toContain('Esc cancel');
  expect(navigateQuestion(dialog, 'return')).toBe('submit');
  expect(Object.keys(dialog.answers)).toEqual(['a', 'b']);
});
test('malformed payloads do not masquerade as selectable questions', () => {
  expect(createQuestionDialog('a', '{"type":"questions","questions":[null]}')).toBeUndefined();
  expect(createQuestionDialog('a', '{"type":"permission_request"}')).toBeUndefined();
  expect(createQuestionDialog('a', 'Explain your goal', true)?.editing).toBe(true);
});
