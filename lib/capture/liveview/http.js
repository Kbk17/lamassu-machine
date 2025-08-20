const crypto = require('node:crypto')
const http = require('node:http')

const PORT = 3456
const HOST = "localhost"
const MAX_PENDING_FRAMES = 3
const WRITING_INTERVAL = 50 // 20/1 FPS = 1000/20 ms/frame = 50 ms/frame


/*
 * A queue of fixed maximum length. When the maximum length is reached, old
 * elements are discarded upon enqueueing new ones.
 */
const SpillOverQueue = (N) => {
  const a = []

  const enq = (elem) => {
    if (a.length >= N)
      a.shift()
    a.push(elem)
  }

  const deq = () => a.shift()

  const clear = () => {
    a.length = 0
  }

  return { enq, deq, clear }
}


const Semaphore = (N) => {
  let credits = N

  const take = () => {
    const ret = credits > 0
    if (ret) credits--
    return ret
  }

  const put = () => {
    credits++
  }

  return { take, put }
}


const ReplaceableSingleton = (initialOnReplace) => {
  let onreplace = initialOnReplace

  const replace = (newOnReplace) => {
    onreplace?.()
    onreplace = newOnReplace
  }

  return {
    replace,
  }
}


const writeFrame = (res, boundaryLine, frame, written) => {
  res.write(boundaryLine)
  res.write("Cache-Control: no-store\n") // Tell the browser not to cache
  res.write("Content-Type: image/jpeg\n")
  res.write(`Content-Length: ${frame.length.toString()}\n`)
  res.write("\n")
  res.write(frame, written)
  res.write("\n")
}

const makeRequestHandler = ({ onrequest, queue}) => {
  const boundary = crypto.randomBytes(64).toString('hex')
  const boundaryLine = `--${boundary}\n`
  const contentType = `multipart/x-mixed-replace; boundary=${boundary}`

  const requestHandler = (req, res) => {
    let closed = false
    const close = () => {
      if (closed) return
      clearInterval(interval)
      res.end()
      req.socket?.end()
      closed = true
    }

    onrequest(close)
    req.once('close', close)
    req.once('timeout', close)

    res.socket.setKeepAlive(false) // Disable TCP keep-alive
    res.setHeader('Connection', "close") // Disable HTTP keep-alive
    res.setHeader('Cache-Control', "no-store") // Tell the browser not to cache
    res.setHeader('Content-Type', contentType)

    const pending = Semaphore(MAX_PENDING_FRAMES)
    const interval = setInterval(() => {
      if (!pending.take())
        return

      const frame = queue.deq()
      if (!frame) // Browser is faster than the camera
        return pending.put()

      writeFrame(res, boundaryLine, frame, pending.put)
    }, WRITING_INTERVAL)
  }

  return requestHandler
}


let liveview = null

const startServer = () => {
  const { replace: onrequest } = ReplaceableSingleton()
  const queue = SpillOverQueue(MAX_PENDING_FRAMES)
  const requestHandler = makeRequestHandler({ onrequest, queue })

  const startPromise = new Promise((_, reject) => {
    http.createServer(requestHandler)
      .listen(PORT, HOST, () => {
        console.log("[liveview] server started")
      })
      .on('close', () => {
        console.log("[liveview] server closed")
        liveview = null
      })
      .on('clientError', (err, sock) => {
        console.log("[liveview] client error:", err)
        sock.end()
      })
      .on('error', err => {
        liveview = null
        reject(err)
      })
  })

  return { queue, startPromise }
}

const start = () => {
  liveview?.queue.clear() // Remove any queued frames from the previous scan
  liveview ??= startServer()
  liveview.startPromise
    .catch(err => {
      setTimeout(start, 50)
      if (err.code === 'EADDRINUSE')
        console.log("[liveview] address in use...")
      else
        console.log("[liveview] server error:", err)
    })
}

const trySend = frame =>
  liveview?.queue.enq(frame)

module.exports = {
  start,
  trySend,
}
