const NON_TEXT_INPUTS = ['range', 'button', 'checkbox', 'radio']

/** Whether a key press is going into a text field, so global shortcuts must leave it alone. */
export const isTypingTarget = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    ['SELECT', 'TEXTAREA'].includes(t.tagName) ||
    (t instanceof HTMLInputElement && !NON_TEXT_INPUTS.includes(t.type)))
