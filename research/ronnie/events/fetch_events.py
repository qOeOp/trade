"""Fetch event dates for events-v1: FOMC decision days (federalreserve.gov) and CPI release days (ALFRED CPIAUCSL
vintage dates). Writes events/calendar.csv with columns event, date.
"""
import os, re, subprocess

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
MONTHS = {m[:3]: i for i, m in enumerate(("January", "February", "March", "April", "May", "June", "July", "August",
                                      "September", "October", "November", "December"), 1)}


def get(url):
    return subprocess.run(["curl", "-sS", "-L", "--http1.1", "--max-time", "60", url], capture_output=True, check=True,
                          text=True).stdout


def fomc():
    out = []
    page = get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm")
    for block in re.split(r'<h4><a id="\d+">', page)[1:]:
        year = int(block[:4])
        for month, day in re.findall(r'fomc-meeting__month[^>]*><strong>([^<]+)</strong>.*?fomc-meeting__date[^>]*>([^<]+)<', block, re.S):
            out.append((year, month, day))
    for year in (2017, 2018, 2019, 2020):
        page = get(f"https://www.federalreserve.gov/monetarypolicy/fomchistorical{year}.htm")
        for month, day in re.findall(r'panel-heading--shaded">([A-Za-z/]+) ([0-9-]+) (?:Meeting|\(unscheduled\)(?: Meeting)?) - ' + str(year), page):
            out.append((year, month, day))
    rows = []
    for year, month, day in out:
        if "notation" in day or "cancel" in day.lower():
            continue
        last_month = month.split("/")[-1].strip()[:3]
        if last_month not in MONTHS:
            continue
        d = re.findall(r"\d+", day)
        if not d:
            continue
        rows.append(("FOMC", pd.Timestamp(year, MONTHS[last_month], int(d[-1])).date()))
    return rows


def cpi():
    page = get("https://alfred.stlouisfed.org/series/downloaddata?seid=CPIAUCSL")
    sel = re.search(r'id="form_selected_vintage_dates".*?</select>', page, re.S).group(0)
    v = pd.Series(pd.to_datetime(re.findall(r'value="(\d{4}-\d{2}-\d{2})"', sel)))
    v = v[(v >= "2017-01-01")]
    last = v.groupby(v.dt.to_period("M")).max()
    return [("CPI", d.date()) for d in last]


def main():
    cal = pd.DataFrame(fomc() + cpi(), columns=["event", "date"]).drop_duplicates().sort_values(["event", "date"])
    cal.to_csv(os.path.join(HERE, "calendar.csv"), index=False)
    for e, g in cal.groupby("event"):
        print(e, len(g), g.date.min(), g.date.max())


if __name__ == "__main__":
    main()
