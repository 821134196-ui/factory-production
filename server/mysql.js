import {Worker, MessageChannel, receiveMessageOnPort} from 'node:worker_threads';

// Existing services use synchronous transaction callbacks. A dedicated worker owns
// one connection so all statements, including nested savepoints, stay on it.
export function openMySQL() {
  const {port1, port2} = new MessageChannel();
  const signal = new Int32Array(new SharedArrayBuffer(4));
  const worker = new Worker(new URL('./mysql-worker.js', import.meta.url), {
    workerData: {port: port2, signal}, transferList: [port2]
  });
  let closed = false;
  function call(operation, sql, args = []) {
    if (closed) throw new Error('MySQL connection closed');
    Atomics.store(signal, 0, 0);
    port1.postMessage({operation, sql, args});
    if (Atomics.wait(signal, 0, 0, 60000) === 'timed-out') {
      closed = true;
      worker.terminate();
      throw new Error('MySQL connection timeout');
    }
    const {result, error} = receiveMessageOnPort(port1).message;
    if (error) throw Object.assign(new Error(error.message), {code:error.code});
    return result;
  }
  return {
    prepare(sql) {
      return {all: (...args)=>call('all',sql,args), get: (...args)=>call('get',sql,args),
        run: (...args)=>call('run',sql,args)};
    },
    exec(sql) { for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) call('run',statement); },
    close() { if (!closed) { try { call('close'); } finally { closed=true; port1.close();worker.terminate(); } } }
  };
}
