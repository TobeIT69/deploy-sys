export class Logger {
  constructor(verbose = false) {
    this.verbose = verbose;
  }

  info(message) {
    console.log(`ℹ️  ${message}`);
  }

  success(message) {
    console.log(`✅ ${message}`);
  }

  error(message) {
    console.error(`❌ ${message}`);
  }

  warn(message) {
    console.warn(`⚠️  ${message}`);
  }

  debug(message) {
    if (this.verbose) {
      console.log(`🔍 ${message}`);
    }
  }

  step(message) {
    console.log(`🔄 ${message}`);
  }
}
