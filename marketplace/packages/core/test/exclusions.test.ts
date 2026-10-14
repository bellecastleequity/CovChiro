import { describe, expect, it } from "vitest";
import { csvRows, exclusionRowKey, matchExclusion, parseExclusionFile } from "../src";

const LEIE = `LASTNAME,FIRSTNAME,MIDNAME,BUSNAME,GENERAL,SPECIALTY,UPIN,NPI,DOB,ADDRESS,CITY,STATE,ZIP,EXCLTYPE,EXCLDATE,REINDATE,WAIVERDATE,WVRSTATE
"SMITH","JOHN","A","","IND- LIC HC SERV PRO","CHIROPRACTOR","","0000000000","19700101","1 MAIN ST","TAMPA","FL","33602","1128a1","20200115","00000000","00000000",""
"DOE","JANE","","","IND- LIC HC SERV PRO","NURSE/NURSES AIDE","","1234567893","19800101","2 OAK","AUSTIN","TX","78701","1128b4","20210301","00000000","00000000",""
"OLD","REINSTATED","","","","","","","","","","GA","","1128b4","20100101","20150101","00000000",""
"","","","ACME BILLING, INC","BUSINESS","","","","","","","OH","","1128a1","20190101","00000000","00000000",""
`;
const SAM = `"Classification","Name","Prefix","First","Middle","Last","Suffix","Address 1","Address 2","Address 3","Address 4","City","State / Province","Country","Zip Code","Open Data Flag","Blank (Deprecated)","Unique Entity ID","Exclusion Program","Excluding Agency","CT Code","Exclusion Type","Additional Comments","Active Date","Termination Date","Record Status","Cross-Reference","SAM Number","CAGE","NPI","Creation_Date"
"Individual","","","ROBERT","","BROWN","","","","","","ATLANTA","GA","USA","","","","","Reciprocal","HHS","","Prohibition/Restriction","","01/02/2020","Indefinite","Active","","S4MR","","","01/02/2020"
"Individual","","","OVER","","DONE","","","","","","MIAMI","FL","USA","","","","","Reciprocal","HHS","","Prohibition/Restriction","","01/02/2015","01/02/2016","Active","","S4MR","","",""
`;

describe("reading the lists", () => {
  it("handles quotes and commas inside fields", () => {
    expect(csvRows('a,"b, c","say ""hi"""\n1,2,3')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });
  it("reads LEIE, keeping people in force and dropping reinstated and business-only rows", () => {
    const r = parseExclusionFile(LEIE);
    expect(r.source).toBe("LEIE");
    expect(r.rows.map((x) => x.lastName)).toEqual(["SMITH", "DOE"]);
    expect(r.rows[0]).toMatchObject({ npi: null, state: "FL", exclDate: "2020-01-15", specialty: expect.stringContaining("CHIROPRACTOR") });
    expect(r.rows[1].npi).toBe("1234567893");
    expect(r.skipped).toBe(2);
  });
  it("reads a SAM.gov extract, dropping terminated listings", () => {
    const r = parseExclusionFile(SAM, new Date("2026-10-14"));
    expect(r.source).toBe("SAM");
    expect(r.rows.map((x) => `${x.firstName} ${x.lastName} ${x.state}`)).toEqual(["ROBERT BROWN GA"]);
  });
  it("refuses other files", () => {
    expect(() => parseExclusionFile("a,b\n1,2")).toThrow(/doesn't look like/);
  });
});

describe("matching a provider", () => {
  const rows = parseExclusionFile(LEIE).rows;
  const who = (over: Partial<Parameters<typeof matchExclusion>[0]> = {}) => ({ npi: null, legalName: "Dr. John Smith", states: ["FL"], professionWords: ["CHIRO"], clearedKeys: [], ...over });
  it("an NPI on the list is excluded", () => {
    expect(matchExclusion(who({ npi: "1234567893", legalName: "Someone Else" }), rows)).toMatchObject({ result: "EXCLUDED", reason: expect.stringMatching(/NPI 1234567893/) });
  });
  it("same name in their state or profession is a possible match; elsewhere it's ignored", () => {
    expect(matchExclusion(who(), rows).result).toBe("POSSIBLE_MATCH");
    expect(matchExclusion(who({ states: ["GA"] }), rows).result).toBe("POSSIBLE_MATCH"); // specialty says chiropractor
    expect(matchExclusion(who({ states: ["GA"], professionWords: ["MASSAGE"] }), rows).result).toBe("CLEAR");
    expect(matchExclusion(who({ legalName: "Johnny Smith" }), rows).result).toBe("CLEAR");
  });
  it("a listing marked 'not the same person' is never flagged again", () => {
    const key = exclusionRowKey(rows[0]);
    expect(matchExclusion(who({ clearedKeys: [key] }), rows).result).toBe("CLEAR");
  });
});
