export interface ModalDescriptor { id: string; title: string; payload?: unknown }
export class ModalContext { private stack: ModalDescriptor[] = []; open(modal: ModalDescriptor): void { this.stack.push(modal); } close(id?: string): void { id ? this.stack = this.stack.filter((modal) => modal.id !== id) : this.stack.pop(); } get active(): ModalDescriptor | undefined { return this.stack.at(-1); } }
