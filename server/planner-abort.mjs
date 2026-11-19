/** 排队和不支持 signal 的操作也需要响应取消；底层操作应同时接收相同信号。 */
export function waitForPlannerOperation(operation, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(operation).then(
      (value) => { signal.removeEventListener('abort', cancel); resolve(value); },
      (error) => { signal.removeEventListener('abort', cancel); reject(error); },
    );
    if (signal.aborted) cancel();
  });
}
