import { getArrayBuffer, calculateCRC, readRecord } from './binary';

export default class EasyFit {
  constructor(options = {}) {
    this.options = Object.assign({}, {
      force: true,
      speedUnit: 'm/s',
      lengthUnit: 'm',
      temperatureUnit: 'celsius',
      elapsedRecordField: false,
      mode: 'list',
    }, options);
  }

  parse(content, callback) {
    const blob = new Uint8Array(getArrayBuffer(content));

    if (blob.length < 12) {
      callback('File to small to be a FIT file', {});
      if (!this.options.force) {
        return;
      }
    }

    const headerLength = blob[0];
    if (headerLength !== 14 && headerLength !== 12) {
      callback('Incorrect header size', {});
      if (!this.options.force) {
        return;
      }
    }

    let fileTypeString = '';
    for (let i = 8; i < 12; i++) {
      fileTypeString += String.fromCharCode(blob[i]);
    }
    if (fileTypeString !== '.FIT') {
      callback('Missing \'.FIT\' in header', {});
      if (!this.options.force) {
        return;
      }
    }

    if (headerLength === 14) {
      const crcHeader = blob[12] + (blob[13] << 8);
      const crcHeaderCalc = calculateCRC(blob, 0, 12);
      if (crcHeader !== crcHeaderCalc) {
        // callback('Header CRC mismatch', {});
        // TODO: fix Header CRC check
        if (!this.options.force) {
          return;
        }
      }
    }
    const dataLength = blob[4] + (blob[5] << 8) + (blob[6] << 16) + (blob[7] << 24);
    const crcStart = dataLength + headerLength;
    const crcFile = blob[crcStart] + (blob[crcStart + 1] << 8);
    const crcFileCalc = calculateCRC(blob, headerLength === 12 ? 0 : headerLength, crcStart);

    if (crcFile !== crcFileCalc) {
      // callback('File CRC mismatch', {});
      // TODO: fix File CRC check
      if (!this.options.force) {
        return;
      }
    }

    const fitObj = {};
    const sessions = [];
    const laps = [];
    const records = [];
    const events = [];

    let tempLaps = [];
    let tempRecords = [];

    let loopIndex = headerLength;
    const messageTypes = [];

    const isModeCascade = this.options.mode === 'cascade';
    const isCascadeNeeded = isModeCascade || this.options.mode === 'both';

    let startDate;

    while (loopIndex < crcStart) {
      const { nextIndex,
        messageType,
        message } = readRecord(blob, messageTypes, loopIndex, this.options, startDate);
      loopIndex = nextIndex;
      switch (messageType) {
        case 'lap':
          if (isCascadeNeeded) {
            message.records = tempRecords;
            tempRecords = [];
            tempLaps.push(message);
          }
          laps.push(message);
          break;
        case 'session':
          if (isCascadeNeeded) {
            message.laps = tempLaps;
            tempLaps = [];
          }
          sessions.push(message);
          break;
        case 'event':
          events.push(message);
          break;
        case 'record':
          if (!startDate) {
            startDate = message.timestamp;
            message.elapsed_time = 0;
          }
          records.push(message);
          if (isCascadeNeeded) {
            tempRecords.push(message);
          }
          break;
        default:
          if (messageType !== '') {
            fitObj[messageType] = message;
          }
          break;
      }
    }

    if (isCascadeNeeded) {
      fitObj.activity.sessions = sessions;
      fitObj.activity.events = events;
    }
    if (!isModeCascade) {
      fitObj.sessions = sessions;
      fitObj.laps = laps;
      fitObj.records = records;
      fitObj.events = events;
    }

    callback(null, fitObj);
  }
}

