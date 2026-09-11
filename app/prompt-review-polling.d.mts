export class PromptReviewRecoveryReader<T> {
  read(key: string, load: () => Promise<T>): Promise<T>;
  release(key: string, response: Promise<T>): void;
}
