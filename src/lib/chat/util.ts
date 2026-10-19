// Small helpers shared by the loop and the confirmation path.

/** Rejects with a TimeoutError when the promise takes longer than `ms` (the work itself is not stopped). */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), Math.max(1_000, ms));
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
