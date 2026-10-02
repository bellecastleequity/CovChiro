import { describe, expect, it } from "vitest";
import { areaBySlug, citiesByRateGroup, faqLd, jsonLd, serviceLd, SERVICE_AREAS, stateAreasBySlug } from "../src/seo";

describe("service areas", () => {
  it("finds states and areas by URL slug", () => {
    expect(stateAreasBySlug("Florida")?.code).toBe("FL");
    expect(areaBySlug("florida", "central-florida")?.area.name).toBe("Central Florida");
    expect(areaBySlug("florida", "nowhere")).toBeNull();
    expect(areaBySlug("texas", "central-florida")).toBeNull();
  });
  it("every Florida city falls in one of the live rate groups", () => {
    const major = { id: "major", zip3List: ["320", "322", "327", "328", "330", "331", "332", "333", "334", "335", "336", "337", "347"] };
    const smaller = { id: "smaller", zip3List: ["321", "323", "324", "325", "326", "329", "338", "339", "341", "342", "344", "346", "349"] };
    const all = SERVICE_AREAS[0].areas.flatMap((a) => a.cities);
    const grouped = citiesByRateGroup(all, [major, smaller]);
    expect((grouped.get("major")?.length ?? 0) + (grouped.get("smaller")?.length ?? 0)).toBe(all.length);
    expect(grouped.get("major")!.map((c) => c.name)).toContain("Miami");
    expect(grouped.get("smaller")!.map((c) => c.name)).toContain("Tallahassee");
  });
});

describe("JSON-LD", () => {
  it("can't break out of its script tag", () => {
    const s = jsonLd(faqLd([["What about </script><script>alert(1)</script>?", "A & B"]]));
    expect(s).not.toContain("</script>");
    expect(JSON.parse(s).mainEntity[0].name).toBe("What about </script><script>alert(1)</script>?");
  });
  it("builds a service with a price range from cents", () => {
    const ld = serviceLd({ name: "x", description: "y", url: "https://a/x", siteUrl: "https://a", serviceType: "Chiropractic coverage", areaServed: ["Florida", "Tampa, FL"], lowPriceCents: 25000, highPriceCents: 62500 });
    expect(ld.offers).toMatchObject({ lowPrice: "250.00", highPrice: "625.00", priceCurrency: "USD" });
    expect(ld.areaServed).toEqual([{ "@type": "State", name: "Florida" }, { "@type": "City", name: "Tampa, FL" }]);
  });
});
