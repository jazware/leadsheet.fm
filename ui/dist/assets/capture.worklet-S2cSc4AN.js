// Posts microphone audio to the page in 2048-sample blocks, all input
// channels mixed (a guitar on input 2 of an interface is heard too).
class Capture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(2048)
    this.n = 0
  }
  process(inputs) {
    const chans = inputs[0] || []
    const ch = chans[0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        // Summed, not averaged: one live channel keeps its full level.
        let v = 0
        for (let c = 0; c < chans.length; c++) v += chans[c][i]
        this.buf[this.n++] = v
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf, [this.buf.buffer])
          this.buf = new Float32Array(2048)
          this.n = 0
        }
      }
    }
    return true
  }
}
registerProcessor('leadsheet-capture', Capture)
