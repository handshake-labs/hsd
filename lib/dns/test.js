// const bio = require('bufio');
// const {Struct} = bio;

//
const bio = require('bufio');
// const key = require('./key');
const {Struct} = bio;

// const {
//   sizeName,
//   writeNameBW,
//   readNameBR,
//   sizeString,
//   writeStringBW,
//   readStringBR,
//   isName,
//   readIP,
//   writeIP
// } = encoding;
//
// const {
//   Message,
//   Record,
//   ARecord,
//   AAAARecord,
//   NSRecord,
//   TXTRecord,
//   DSRecord,
//   types
// } = wire;
//
/*
 * Constants
 */

const DUMMY = Buffer.alloc(0);

const DEFAULT_TTL = 21600;

const hsTypes = {
  DS: 0,
  NS: 1,
  GLUE4: 2,
  GLUE6: 3,
  SYNTH4: 4,
  SYNTH6: 5,
  TXT: 6
};

function typeToClass(type) {
  // assert((type & 0xff) === type);
  switch (type) {
    case hsTypes.DS:
      return DS;
    case hsTypes.NS:
      return NS;
    case hsTypes.GLUE4:
      return GLUE4;
    case hsTypes.GLUE6:
      return GLUE6;
    case hsTypes.SYNTH4:
      return SYNTH4;
    case hsTypes.SYNTH6:
      return SYNTH6;
    case hsTypes.TXT:
      return TXT;
    default:
      return null;
  }
}


const hsTypesByVal = {
  [hsTypes.DS]: 'DS',
  [hsTypes.NS]: 'NS',
  [hsTypes.GLUE4]: 'GLUE4',
  [hsTypes.GLUE6]: 'GLUE6',
  [hsTypes.SYNTH4]: 'SYNTH4',
  [hsTypes.SYNTH6]: 'SYNTH6',
  [hsTypes.TXT]: 'TXT'
};

/**
 * Resource
 * @extends {Struct}
 */

class Resource extends Struct {
  constructor() {
    super();
    this.ttl = DEFAULT_TTL;
    this.records = [];
  }

  hasType(type) {
    assert((type & 0xff) === type);

    for (const record of this.records) {
      if (record.type === type)
        return true;
    }

    return false;
  }

  hasNS() {
    for (const {type} of this.records) {
      if (type < hsTypes.NS || type > hsTypes.SYNTH6)
        continue;

      return true;
    }

    return false;
  }

  hasDS() {
    return this.hasType(hsTypes.DS);
  }

  encode() {
    const bw = bio.write(512);
    this.write(bw, new Map());
    return bw.slice();
  }

  getSize(map) {
    let size = 1;

    for (const rr of this.records)
      size += 1 + rr.getSize(map);

    return size;
  }

  write(bw, map) {
    bw.writeU8(0);

    for (const rr of this.records) {
      bw.writeU8(rr.type);
      rr.write(bw, map);
    }

    return this;
  }

  read(br) {
    const version = br.readU8();

    if (version !== 0)
      throw new Error(`Unknown serialization version: ${version}.`);

    while (br.left()) {
      const RD = typeToClass(br.readU8());

      // Break at unknown records.
      if (!RD)
        break;

      this.records.push(RD.read(br));
    }

    return this;
  }

  toNS(name) {
    const authority = [];
    const set = new Set();

    for (const record of this.records) {
      switch (record.type) {
        case hsTypes.NS:
        case hsTypes.GLUE4:
        case hsTypes.GLUE6:
        case hsTypes.SYNTH4:
        case hsTypes.SYNTH6:
          break;
        default:
          continue;
      }

      const rr = record.toDNS(name, this.ttl);

      if (set.has(rr.data.ns))
        continue;

      set.add(rr.data.ns);
      authority.push(rr);
    }

    return authority;
  }

  toGlue(name) {
    const additional = [];

    for (const record of this.records) {
      switch (record.type) {
        case hsTypes.GLUE4:
        case hsTypes.GLUE6:
          if (!util.isSubdomain(name, record.ns))
            continue;
          break;
        case hsTypes.SYNTH4:
        case hsTypes.SYNTH6:
          break;
        default:
          continue;
      }

      additional.push(record.toGlue(record.ns, this.ttl));
    }

    return additional;
  }

  toDS(name) {
    const answer = [];

    for (const record of this.records) {
      if (record.type !== hsTypes.DS)
        continue;

      answer.push(record.toDNS(name, this.ttl));
    }

    return answer;
  }

  toTXT(name) {
    const answer = [];

    for (const record of this.records) {
      if (record.type !== hsTypes.TXT)
        continue;

      answer.push(record.toDNS(name, this.ttl));
    }

    return answer;
  }

  toZone(name, sign = false) {
    const zone = [];
    const set = new Set();

    for (const record of this.records) {
      const rr = record.toDNS(name, this.ttl);

      if (rr.type === types.NS) {
        if (set.has(rr.data.ns))
          continue;

        set.add(rr.data.ns);
      }

      zone.push(rr);
    }

    if (sign) {
      const set = new Set();

      for (const rr of zone)
        set.add(rr.type);

      const types = [...set].sort();

      for (const type of types)
        key.signZSK(zone, type);
    }

    // Add the glue last.
    for (const record of this.records) {
      switch (record.type) {
        case hsTypes.GLUE4:
        case hsTypes.GLUE6:
        case hsTypes.SYNTH4:
        case hsTypes.SYNTH6: {
          if (!util.isSubdomain(name, record.ns))
            continue;

          zone.push(record.toGlue(record.ns, this.ttl));
          break;
        }
      }
    }

    return zone;
  }

  toReferral(name) {
    const res = new Message();

    if (this.hasNS()) {
      res.authority = [
        ...this.toNS(name),
        ...this.toDS(name)
      ];

      res.additional = this.toGlue(name);

      // Note: should have nsec unsigned zone proof.
      if (!this.hasDS())
        key.signZSK(res.authority, types.NS);
      else
        key.signZSK(res.authority, types.DS);
    } else {
      // Needs SOA.
    }

    return res;
  }

  toDNS(name, type) {
    assert(util.isFQDN(name));
    assert((type >>> 0) === type);

    const labels = util.split(name);

    // Referral.
    if (labels.length > 1) {
      const tld = util.from(name, labels, -1);
      return this.toReferral(tld);
    }

    // Potentially an answer.
    const res = new Message();

    switch (type) {
      case types.NS:
        res.authority = this.toNS(name);
        res.additional = this.toGlue(name);
        key.signZSK(res.authority, types.NS);
        break;
      case types.TXT:
        res.answer = this.toTXT(name);
        key.signZSK(res.answer, types.TXT);
        break;
      case types.DS:
        res.answer = this.toDS(name);
        key.signZSK(res.answer, types.DS);
        break;
    }

    // Nope, we need a referral.
    if (res.answer.length === 0
        && res.authority.length === 0) {
      return this.toReferral(name);
    }

    // We're authoritative for the answer.
    res.aa = res.answer.length !== 0;

    return res;
  }

  getJSON(name) {
    const json = { records: [] };

    for (const record of this.records)
      json.records.push(record.getJSON());

    return json;
  }

  fromJSON(json) {
    assert(json && typeof json === 'object', 'Invalid json.');
    assert(Array.isArray(json.records), 'Invalid records.');

    for (const item of json.records) {
      assert(item && typeof item === 'object', 'Invalid record.');

      const RD = stringToClass(item.type);

      if (!RD)
        throw new Error(`Unknown type: ${item.type}.`);

      this.records.push(RD.fromJSON(item));
    }

    return this;
  }
}


var br = Buffer.from("0001036e73320a6e616d6573657276657202696f0001036e7331c00601036e7333c00601036e7334c006", "hex")
console.log(Resource.decode(br))
