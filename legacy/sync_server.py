import http.server
import socketserver
import subprocess
import json
from datetime import datetime, timedelta

PORT = 8765

TARGET_CALENDARS = ["FSB", "RMIT", "Outlook"]

APPLESCRIPT = """
tell application "Calendar"
    set outList to {}
    set startDateLimit to (current date) - (180 * days)
    set endDateLimit to (current date) + (180 * days)
    
    repeat with c in calendars
        set cName to name of c
        set isTarget to false
        repeat with t in {"FSB", "RMIT", "Outlook", "Calendar", "Lịch", "Work"}
            if cName contains t then
                set isTarget to true
                exit repeat
            end if
        end repeat
        
        if isTarget then
            set evList to (every event of c whose start date >= startDateLimit and start date <= endDateLimit)
            repeat with ev in evList
                try
                    set evSummary to summary of ev
                    set evStart to start date of ev
                    
                    set y to year of evStart as string
                    set m to text -2 thru -1 of ("0" & ((month of evStart as integer) as string))
                    set d to text -2 thru -1 of ("0" & ((day of evStart) as string))
                    set dateStr to y & "-" & m & "-" & d
                    
                    set rec to ""
                    try
                        set rawRec to recurrence of ev
                        if rawRec is not missing value then
                            set rec to rawRec
                        end if
                    end try
                    
                    set end of outList to (evSummary & "::" & dateStr & "::" & cName & "::" & rec)
                end try
            end repeat
        end if
    end repeat
    
    set AppleScript's text item delimiters to linefeed
    return outList as string
end tell
"""

def expand_rrule(start_date, rrule_str, max_date):
    rules = dict(item.split('=') for item in rrule_str.split(';') if '=' in item)
    freq = rules.get('FREQ')
    interval = int(rules.get('INTERVAL', 1))
    count = int(rules.get('COUNT', 0))
    until = rules.get('UNTIL')
    
    if until:
        try:
            until_date = datetime.strptime(until[:8], '%Y%m%d').date()
        except ValueError:
            until_date = max_date
    else:
        until_date = max_date

    byday = rules.get('BYDAY', '')
    if byday:
        byday_list = byday.split(',')
        day_map = {'MO': 0, 'TU': 1, 'WE': 2, 'TH': 3, 'FR': 4, 'SA': 5, 'SU': 6}
        byday_nums = [day_map[day[-2:]] for day in byday_list if day[-2:] in day_map]
    else:
        byday_nums = []

    occurrences = []
    current_date = start_date
    instances = 0

    if freq == 'WEEKLY':
        while current_date <= min(until_date, max_date):
            if count > 0 and instances >= count: break
            
            week_start = current_date - timedelta(days=current_date.weekday())
            for i in range(7):
                day = week_start + timedelta(days=i)
                if day >= start_date and day <= min(until_date, max_date):
                    if byday_nums:
                        if day.weekday() in byday_nums:
                            if count == 0 or instances < count:
                                occurrences.append(day)
                                instances += 1
                    else:
                        if day.weekday() == start_date.weekday():
                            if count == 0 or instances < count:
                                occurrences.append(day)
                                instances += 1
            current_date = week_start + timedelta(days=7 * interval)
            
    elif freq == 'DAILY':
        while current_date <= min(until_date, max_date):
            if count > 0 and instances >= count: break
            occurrences.append(current_date)
            instances += 1
            current_date += timedelta(days=interval)
    else:
        occurrences.append(start_date)

    return occurrences

class SyncHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/api/sync-calendar':
            try:
                res = subprocess.run(['osascript', '-e', APPLESCRIPT], capture_output=True, text=True, check=True)
                raw_lines = res.stdout.strip().split('\n')
                
                today = datetime.now().date()
                max_date = today + timedelta(days=180)
                events = []
                
                for line in raw_lines:
                    parts = line.split("::")
                    if len(parts) >= 4:
                        summary = parts[0].strip()
                        date_str = parts[1].strip()
                        cal_name = parts[2].strip()
                        recurrence_str = parts[3].strip()

                        try:
                            ev_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                        except ValueError:
                            continue
                        
                        if recurrence_str:
                            dates_to_add = expand_rrule(ev_date, recurrence_str, max_date)
                        else:
                            dates_to_add = [ev_date]
                        
                        for d in dates_to_add:
                            if today <= d <= max_date and summary:
                                events.append({
                                    "title": summary,
                                    "teachDate": d.strftime("%Y-%m-%d"),
                                    "calendar": cal_name
                                })

                events.sort(key=lambda x: x["teachDate"])

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps(events, ensure_ascii=False).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
        else:
            super().do_GET()

class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

if __name__ == "__main__":
    with ReusableTCPServer(("", PORT), SyncHandler) as httpd:
        httpd.serve_forever()
