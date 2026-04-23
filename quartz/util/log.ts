import truncate from "ansi-truncate"
import readline from "readline"

export class QuartzLogger {
  verbose: boolean
  private spinnerInterval: NodeJS.Timeout | undefined
  private spinnerText: string = ""
  private updateSuffix: string = ""
  private spinnerIndex: number = 0
  private progressCurrent: number | null = null
  private progressTotal: number | null = null
  private readonly spinnerChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  constructor(verbose: boolean) {
    const isInteractiveTerminal =
      process.stdout.isTTY && process.env.TERM !== "dumb" && !process.env.CI
    this.verbose = verbose || !isInteractiveTerminal
  }

  start(text: string) {
    this.spinnerText = text

    if (this.verbose) {
      console.log(text)
    } else {
      this.spinnerIndex = 0
      this.spinnerInterval = setInterval(() => {
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)

        const columns = process.stdout.columns || 80
        let output = `${this.spinnerChars[this.spinnerIndex]} ${this.spinnerText}`
        if (
          this.progressCurrent !== null &&
          this.progressTotal !== null &&
          this.progressTotal > 0
        ) {
          const ratio = Math.min(1, Math.max(0, this.progressCurrent / this.progressTotal))
          const width = 20
          const filled = Math.round(width * ratio)
          const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)}`
          output += ` [${bar}] ${this.progressCurrent}/${this.progressTotal}`
        }
        if (this.updateSuffix) {
          output += `: ${this.updateSuffix}`
        }

        const truncated = truncate(output, columns)
        process.stdout.write(truncated)
        this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerChars.length
      }, 50)
    }
  }

  updateText(text: string) {
    this.updateSuffix = text
  }

  updateProgress(current: number, total: number) {
    this.progressCurrent = current
    this.progressTotal = total
  }

  end(text?: string) {
    if (!this.verbose && this.spinnerInterval) {
      clearInterval(this.spinnerInterval)
      this.spinnerInterval = undefined
      readline.clearLine(process.stdout, 0)
      readline.cursorTo(process.stdout, 0)
    }

    if (text) {
      console.log(text)
    }

    this.progressCurrent = null
    this.progressTotal = null
    this.updateSuffix = ""
  }
}
