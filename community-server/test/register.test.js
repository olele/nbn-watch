import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseRegister, registerTime } from "../src/logic.js";

const CSV = `Outage title,Reference,Outage type,Start date of outage,Start time of outage,End date of outage,End time of outage,Duration of outage,Affected suburb(s)/towns,Affected State(s)/Territories,Affected postcode(s),Types of services affected,Number of each type of service affected,Number of premises affected,Carrier or carriage service provider responsible for resolving outage,Cause (high-level),Cause (related to a natural event or weather),Additional information,Date entry first published,Date entry last rectified (if relevant)
Affecting multiple technologies in the Hunter region,ACM000000000150,Significant local outage,20/11/2026,03:04 AEDT,20/11/2026,16:42 AEDT,13.38,Bundabah; Karuah; Tea Gardens,NSW,2323,NBN broadband services connected by means of FTTC; FTTN,147; 466,1022,NBN,Damage by a third party,No,,22/11/2026,
"Affecting Fixed Wireless in the Northern Rivers, NSW",ACM000000000059,Significant local outage,17/04/2026,18:17 AEST,,,,"Ashby; Yamba",NSW,2449; 2464; bad,fixed wireless,1058,1048,NBN,Equipment or system fault or failure,No,"said ""hi""",26/06/2026,
junk,not a ref,,,,,,,,,,,,,,,,,,
`;

test("csv parser handles quotes, commas and blank lines", () => {
  const rows = parseCsv('a,"b, c","d ""e"""\r\n\r\n1,2,3');
  assert.deepEqual(rows, [["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
});

test("register times honour Australian time zones", () => {
  assert.equal(registerTime("20/11/2026", "03:04 AEDT"), Date.UTC(2026, 10, 19, 16, 4) / 1000);
  assert.equal(registerTime("17/04/2026", "18:17 AEST"), Date.UTC(2026, 3, 17, 8, 17) / 1000);
  assert.equal(registerTime("1/2/2026", "10:00 AWST"), Date.UTC(2026, 1, 1, 2, 0) / 1000);
  assert.equal(registerTime("2026-01-01", "10:00"), null);
});

test("register rows become outages", () => {
  const [a, b, ...rest] = parseRegister(CSV);
  assert.equal(rest.length, 0, "bad rows are skipped");
  assert.equal(a.ref, "ACM000000000150");
  assert.deepEqual(a.suburbs, ["Bundabah", "Karuah", "Tea Gardens"]);
  assert.deepEqual(a.postcodes, ["2323"]);
  assert.equal(a.premises, 1022);
  assert.equal(a.duration_h, 13.38);
  assert.equal(a.techs, "FTTC; FTTN");
  assert.equal(a.end_at - a.start_at, (16 * 60 + 42 - (3 * 60 + 4)) * 60);
  assert.equal(b.title, "Affecting Fixed Wireless in the Northern Rivers, NSW");
  assert.deepEqual(b.postcodes, ["2449", "2464"]);
  assert.equal(b.end_at, null);
  assert.equal(b.duration_h, null);
  assert.equal(b.info, 'said "hi"');
});
