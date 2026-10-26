import { describe, expect, it } from 'vitest';
import { albumRipVerdict, decodeLogBytes, logDisc, parseRipLog } from './rip-log.ts';

// Line formats copied from real logs in the collection this was built for.
const EAC_SUMMARY = `Exact Audio Copy V1.8 from 15. July 2024

EAC extraction logfile from 4. May 2025, 18:21
Used drive  : HL-DT-STBD-RE  BE14NU40   Adapter: 1  ID: 0
Read mode               : Secure
Read offset correction                      : 6
     Test CRC 06E6CCC8
     Copy CRC 06E6CCC8
No errors occurred
AccurateRip summary
Track  1  accurately ripped (confidence 200)  [401DC439]  (AR v2)
Track  2  accurately ripped (confidence 37)  [669A874E]  (AR v2)
All tracks accurately ripped
Track | CTDB Status
  1   | (1289/1290) Accurately ripped
  2   | (1287/1290) Accurately ripped
==== Log checksum 6887976A3EDBFB0540F56A5A9BEC5AFED4CBD1F36EAAACD7070DD697FF40649C ====`;

const EAC_PER_TRACK = `Exact Audio Copy V0.99 prebeta 4 from 23. January 2008
Read mode               : Secure
Read offset correction                      : 667
Track  1
     Test CRC 506EFAE1
     Copy CRC 506EFAE1
     Track not present in AccurateRip database
     Copy OK
Track  2
     Suspicious position 0:02:20
     Test CRC EF4AFE60
     Copy CRC 0000FE60
     Accurately ripped (confidence 5)  [ABCD1234]
     Copy finished`;

const XLD = `X Lossless Decoder version 20161007 (149.3)
Used drive : MATSHITA DVD-R   UJ-898 (revision HC10)
Ripper mode             : XLD Secure Ripper
Read offset correction  : 102
AccurateRip Summary (DiscID: 000b750c-004c1e9c-7008cd08)
    Track 01 : OK (v1+v2, confidence 377/663)
    Track 01 : OK (v1+v2, confidence 377/663)
    Track 02 : OK (v1+v2, confidence 380/666)
        ->All tracks accurately ripped.
All Tracks
        Read error                           : 0
        Damaged sector count                 : 0
Track 01
    CRC32 hash (test run)    : 15788F23
    CRC32 hash               : 15788F23
        ->Accurately ripped (v1+v2, confidence 177+200/663)
Track 02
    CRC32 hash (test run)    : 1A2B3C4D
    CRC32 hash               : 1A2B3C4D
-----BEGIN XLD SIGNATURE-----`;

const CUETOOLS = `[CUETools log; Date: 16.12.2018 16:14:24; Version: 2.1.4]
[AccurateRip ID: 001a3881-00e4d630-890f970b] found.
Track   [  CRC   |   V2   ] Status
 01     [64ecdb9f|22ba4f84] (143+133/492) Accurately ripped
 02     [e6b2dadf|2e88fe21] (143+132/492) Accurately ripped
Offsetted by -691:
 01     [6336e44d] (000/492) No match (V2 was not tested)
 02     [45389f77] (000/492) No match (V2 was not tested)`;

describe('parseRipLog', () => {
  it('reads an EAC summary with AccurateRip and CTDB', () => {
    expect(parseRipLog(EAC_SUMMARY)).toEqual({
      tool: 'EAC',
      toolVersion: 'V1.8',
      drive: 'HL-DT-STBD-RE  BE14NU40',
      readMode: 'Secure',
      secureMode: true,
      readOffset: 6,
      crcChecks: 1,
      crcMismatches: 0,
      readProblems: 0,
      accurateRip: { accurate: 2, inaccurate: 0, notInDatabase: 0, minConfidence: 37 },
      ctdb: { tracks: 2, accurate: 2 },
      hasChecksum: true,
      verdict: 'verified',
    });
  });

  it('reads per-track EAC logs and flags read problems', () => {
    const r = parseRipLog(EAC_PER_TRACK);
    expect(r).toMatchObject({
      crcChecks: 2,
      crcMismatches: 1,
      readProblems: 1,
      accurateRip: { accurate: 1, inaccurate: 0, notInDatabase: 1, minConfidence: 5 },
      hasChecksum: false,
      verdict: 'problems',
    });
  });

  it('counts XLD tracks once despite repeated summaries', () => {
    expect(parseRipLog(XLD)).toMatchObject({
      tool: 'XLD',
      readMode: 'XLD Secure Ripper',
      readOffset: 102,
      crcChecks: 2,
      readProblems: 0,
      accurateRip: { accurate: 2, inaccurate: 0, notInDatabase: 0, minConfidence: 377 },
      hasChecksum: true,
      verdict: 'verified',
    });
  });

  it('ignores CUETools matches at other offsets', () => {
    expect(parseRipLog(CUETOOLS)).toMatchObject({
      tool: 'CUETools',
      accurateRip: { accurate: 2, inaccurate: 0, minConfidence: 275 },
      verdict: 'verified',
    });
  });

  it('calls an error-free rip with other AccurateRip checksums "differs"', () => {
    const log = `Exact Audio Copy V1.0 beta 3 from 29. August 2011
Read mode               : Secure
No errors occurred
Track  1  cannot be verified as accurate (confidence 5)  [F238422B], AccurateRip returned [DF7AA32F]
Track  2  accurately ripped (confidence 2)  [92E80AAB]`;
    expect(parseRipLog(log).verdict).toBe('differs');
  });

  it('calls a secure rip of a pressing missing from the databases "clean"', () => {
    const log = `${EAC_PER_TRACK.split('Track  2')[0]}`;
    expect(parseRipLog(log).verdict).toBe('clean');
  });

  it('understands Russian and Spanish EAC', () => {
    const russian = `Exact Audio Copy V1.0 beta 3 from 29. August 2011
Дисковод: SONY    CD-RW  CRX210E1   Adapter: 0  ID: 1
Режим чтения                 : Достоверность
Коррекция смещения при чтении                     : 6
     CRC теста E6415002
     CRC копии E6415002
Ошибок не произошло
Трек  1  : извлечено точно (доверие 136)  [EC041B49]  (AR v2)
Трек  2  точное извлечение (доверие 10)  [1FEE2862]`;
    expect(parseRipLog(russian)).toMatchObject({
      drive: 'SONY    CD-RW  CRX210E1',
      secureMode: true,
      readOffset: 6,
      crcChecks: 1,
      accurateRip: { accurate: 2, minConfidence: 10 },
      verdict: 'verified',
    });
    const spanish = `Exact Audio Copy V0.99 prebeta 5 from 4. May 2009
Modo de Lectura           : Seguro
Corrección de Desplazamiento de Lectura         : 667
     Test CRC 73E61D96
     Copiar CRC 73E61D96
Pista  1  no se puede verificar como preciso (confianza 3)  [AF9CD064], AccurateRip devuelto [35D2EB0C]`;
    expect(parseRipLog(spanish)).toMatchObject({
      secureMode: true,
      readOffset: 667,
      crcChecks: 1,
      accurateRip: { inaccurate: 1 },
      verdict: 'differs',
    });
  });

  it('says "unknown" for logs it does not recognize', () => {
    expect(parseRipLog('AUDIOCHECKER v2.0 beta\nCDDA 100%')).toMatchObject({
      tool: 'other',
      verdict: 'unknown',
    });
  });
});

describe('decodeLogBytes', () => {
  it('decodes UTF-16 with a byte-order mark, UTF-8, and Windows-1251', () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('EAC ✓', 'utf16le')]);
    expect(decodeLogBytes(utf16)).toBe('EAC ✓');
    expect(decodeLogBytes(Buffer.from('Ívar', 'utf8'))).toBe('Ívar');
    // "Дисковод" in Windows-1251.
    const cp1251 = Buffer.from([0xc4, 0xe8, 0xf1, 0xea, 0xee, 0xe2, 0xee, 0xe4]);
    expect(decodeLogBytes(cp1251)).toBe('Дисковод');
    expect(decodeLogBytes(Buffer.from([0x43, 0x61, 0x66, 0xe9]))).toBe('Café');
  });
});

describe('albumRipVerdict', () => {
  it('takes the strongest log per disc and the weakest disc', () => {
    expect(
      albumRipVerdict([
        { relPath: 'A/CD1/a.log', verdict: 'clean' },
        { relPath: 'A/CD1/Checkers/a.accurip', verdict: 'verified' },
        { relPath: 'A/CD2/b.log', verdict: 'differs' },
      ]),
    ).toBe('differs');
    expect(
      albumRipVerdict([
        { relPath: 'A/a.log', verdict: 'clean' },
        { relPath: 'A/Checkers/a.accurip', verdict: 'verified' },
      ]),
    ).toBe('verified');
  });

  it('ignores unknown logs unless there is nothing else', () => {
    expect(
      albumRipVerdict([
        { relPath: 'A/CD1/a.log', verdict: 'verified' },
        { relPath: 'A/CD2/b.log', verdict: 'unknown' },
      ]),
    ).toBe('verified');
    expect(albumRipVerdict([{ relPath: 'A/a.log', verdict: 'unknown' }])).toBe('unknown');
    expect(albumRipVerdict([])).toBeNull();
  });

  it('finds the disc folder of a log', () => {
    expect(logDisc('A/Disc 2of2/x.log')).toBe('Disc 2of2');
    expect(logDisc('A/Checkers/x.accurip')).toBeNull();
  });
});
