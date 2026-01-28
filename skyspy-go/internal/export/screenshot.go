// Package export provides export functionality for SkySpy CLI
package export

import (
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// ansiColorMap maps ANSI 256 color codes to hex colors
var ansiColorMap = map[string]string{
	"0":   "#000000", // Black
	"1":   "#800000", // Dark Red
	"2":   "#008000", // Dark Green
	"3":   "#808000", // Dark Yellow
	"4":   "#000080", // Dark Blue
	"5":   "#800080", // Dark Magenta
	"6":   "#008080", // Dark Cyan
	"7":   "#c0c0c0", // Light Gray
	"8":   "#808080", // Dark Gray
	"9":   "#ff0000", // Red
	"10":  "#00ff00", // Green
	"11":  "#ffff00", // Yellow
	"12":  "#0000ff", // Blue
	"13":  "#ff00ff", // Magenta
	"14":  "#00ffff", // Cyan
	"15":  "#ffffff", // White
	"16":  "#000000",
	"17":  "#00005f",
	"18":  "#000087",
	"19":  "#0000af",
	"20":  "#0000d7",
	"21":  "#0000ff",
	"22":  "#005f00",
	"23":  "#005f5f",
	"24":  "#005f87",
	"25":  "#005faf",
	"26":  "#005fd7",
	"27":  "#005fff",
	"28":  "#008700",
	"29":  "#00875f",
	"30":  "#008787",
	"31":  "#0087af",
	"32":  "#0087d7",
	"33":  "#0087ff",
	"34":  "#00af00",
	"35":  "#00af5f",
	"36":  "#00af87",
	"37":  "#00afaf",
	"38":  "#00afd7",
	"39":  "#00afff",
	"40":  "#00d700",
	"41":  "#00d75f",
	"42":  "#00d787",
	"43":  "#00d7af",
	"44":  "#00d7d7",
	"45":  "#00d7ff",
	"46":  "#00ff00",
	"47":  "#00ff5f",
	"48":  "#00ff87",
	"49":  "#00ffaf",
	"50":  "#00ffd7",
	"51":  "#00ffff",
	"52":  "#5f0000",
	"53":  "#5f005f",
	"54":  "#5f0087",
	"55":  "#5f00af",
	"56":  "#5f00d7",
	"57":  "#5f00ff",
	"58":  "#5f5f00",
	"59":  "#5f5f5f",
	"60":  "#5f5f87",
	"61":  "#5f5faf",
	"62":  "#5f5fd7",
	"63":  "#5f5fff",
	"64":  "#5f8700",
	"65":  "#5f875f",
	"66":  "#5f8787",
	"67":  "#5f87af",
	"68":  "#5f87d7",
	"69":  "#5f87ff",
	"70":  "#5faf00",
	"71":  "#5faf5f",
	"72":  "#5faf87",
	"73":  "#5fafaf",
	"74":  "#5fafd7",
	"75":  "#5fafff",
	"76":  "#5fd700",
	"77":  "#5fd75f",
	"78":  "#5fd787",
	"79":  "#5fd7af",
	"80":  "#5fd7d7",
	"81":  "#5fd7ff",
	"82":  "#5fff00",
	"83":  "#5fff5f",
	"84":  "#5fff87",
	"85":  "#5fffaf",
	"86":  "#5fffd7",
	"87":  "#5fffff",
	"88":  "#870000",
	"89":  "#87005f",
	"90":  "#870087",
	"91":  "#8700af",
	"92":  "#8700d7",
	"93":  "#8700ff",
	"94":  "#875f00",
	"95":  "#875f5f",
	"96":  "#875f87",
	"97":  "#875faf",
	"98":  "#875fd7",
	"99":  "#875fff",
	"100": "#878700",
	"101": "#87875f",
	"102": "#878787",
	"103": "#8787af",
	"104": "#8787d7",
	"105": "#8787ff",
	"106": "#87af00",
	"107": "#87af5f",
	"108": "#87af87",
	"109": "#87afaf",
	"110": "#87afd7",
	"111": "#87afff",
	"112": "#87d700",
	"113": "#87d75f",
	"114": "#87d787",
	"115": "#87d7af",
	"116": "#87d7d7",
	"117": "#87d7ff",
	"118": "#87ff00",
	"119": "#87ff5f",
	"120": "#87ff87",
	"121": "#87ffaf",
	"122": "#87ffd7",
	"123": "#87ffff",
	"124": "#af0000",
	"125": "#af005f",
	"126": "#af0087",
	"127": "#af00af",
	"128": "#af00d7",
	"129": "#af00ff",
	"130": "#af5f00",
	"131": "#af5f5f",
	"132": "#af5f87",
	"133": "#af5faf",
	"134": "#af5fd7",
	"135": "#af5fff",
	"136": "#af8700",
	"137": "#af875f",
	"138": "#af8787",
	"139": "#af87af",
	"140": "#af87d7",
	"141": "#af87ff",
	"142": "#afaf00",
	"143": "#afaf5f",
	"144": "#afaf87",
	"145": "#afafaf",
	"146": "#afafd7",
	"147": "#afafff",
	"148": "#afd700",
	"149": "#afd75f",
	"150": "#afd787",
	"151": "#afd7af",
	"152": "#afd7d7",
	"153": "#afd7ff",
	"154": "#afff00",
	"155": "#afff5f",
	"156": "#afff87",
	"157": "#afffaf",
	"158": "#afffd7",
	"159": "#afffff",
	"160": "#d70000",
	"161": "#d7005f",
	"162": "#d70087",
	"163": "#d700af",
	"164": "#d700d7",
	"165": "#d700ff",
	"166": "#d75f00",
	"167": "#d75f5f",
	"168": "#d75f87",
	"169": "#d75faf",
	"170": "#d75fd7",
	"171": "#d75fff",
	"172": "#d78700",
	"173": "#d7875f",
	"174": "#d78787",
	"175": "#d787af",
	"176": "#d787d7",
	"177": "#d787ff",
	"178": "#d7af00",
	"179": "#d7af5f",
	"180": "#d7af87",
	"181": "#d7afaf",
	"182": "#d7afd7",
	"183": "#d7afff",
	"184": "#d7d700",
	"185": "#d7d75f",
	"186": "#d7d787",
	"187": "#d7d7af",
	"188": "#d7d7d7",
	"189": "#d7d7ff",
	"190": "#d7ff00",
	"191": "#d7ff5f",
	"192": "#d7ff87",
	"193": "#d7ffaf",
	"194": "#d7ffd7",
	"195": "#d7ffff",
	"196": "#ff0000",
	"197": "#ff005f",
	"198": "#ff0087",
	"199": "#ff00af",
	"200": "#ff00d7",
	"201": "#ff00ff",
	"202": "#ff5f00",
	"203": "#ff5f5f",
	"204": "#ff5f87",
	"205": "#ff5faf",
	"206": "#ff5fd7",
	"207": "#ff5fff",
	"208": "#ff8700",
	"209": "#ff875f",
	"210": "#ff8787",
	"211": "#ff87af",
	"212": "#ff87d7",
	"213": "#ff87ff",
	"214": "#ffaf00",
	"215": "#ffaf5f",
	"216": "#ffaf87",
	"217": "#ffafaf",
	"218": "#ffafd7",
	"219": "#ffafff",
	"220": "#ffd700",
	"221": "#ffd75f",
	"222": "#ffd787",
	"223": "#ffd7af",
	"224": "#ffd7d7",
	"225": "#ffd7ff",
	"226": "#ffff00",
	"227": "#ffff5f",
	"228": "#ffff87",
	"229": "#ffffaf",
	"230": "#ffffd7",
	"231": "#ffffff",
	"232": "#080808",
	"233": "#121212",
	"234": "#1c1c1c",
	"235": "#262626",
	"236": "#303030",
	"237": "#3a3a3a",
	"238": "#444444",
	"239": "#4e4e4e",
	"240": "#585858",
	"241": "#626262",
	"242": "#6c6c6c",
	"243": "#767676",
	"244": "#808080",
	"245": "#8a8a8a",
	"246": "#949494",
	"247": "#9e9e9e",
	"248": "#a8a8a8",
	"249": "#b2b2b2",
	"250": "#bcbcbc",
	"251": "#c6c6c6",
	"252": "#d0d0d0",
	"253": "#dadada",
	"254": "#e4e4e4",
	"255": "#eeeeee",
}

// GenerateFilename generates a filename with timestamp
func GenerateFilename(prefix, extension, directory string) string {
	timestamp := time.Now().Format("20060102_150405")
	filename := fmt.Sprintf("%s_%s.%s", prefix, timestamp, extension)
	if directory != "" {
		return filepath.Join(directory, filename)
	}
	return filename
}

// SaveAsText saves content as plain text, stripping ANSI codes
func SaveAsText(content string, filename string) error {
	if filename == "" {
		filename = GenerateFilename("skyspy_screenshot", "txt", "")
	}

	// Strip ANSI escape codes
	ansiRegex := regexp.MustCompile(`\x1b\[[0-9;]*m`)
	plainText := ansiRegex.ReplaceAllString(content, "")

	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil && filepath.Dir(filename) != "" && filepath.Dir(filename) != "." {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filename, []byte(plainText), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// SaveAsHTML saves content as styled HTML with ANSI colors converted
func SaveAsHTML(content string, filename string) error {
	if filename == "" {
		filename = GenerateFilename("skyspy_screenshot", "html", "")
	}

	htmlContent := convertANSIToHTML(content)

	if err := os.MkdirAll(filepath.Dir(filename), 0755); err != nil && filepath.Dir(filename) != "" && filepath.Dir(filename) != "." {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(filename, []byte(htmlContent), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// CaptureScreen saves the current view as both text and HTML
func CaptureScreen(content string, directory string) (string, error) {
	filename := GenerateFilename("skyspy_screenshot", "html", directory)

	if err := SaveAsHTML(content, filename); err != nil {
		return "", err
	}

	return filename, nil
}

// convertANSIToHTML converts ANSI terminal output to styled HTML
func convertANSIToHTML(content string) string {
	var sb strings.Builder

	// Write HTML header
	sb.WriteString(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SkySpy Radar Screenshot</title>
    <style>
        body {
            background-color: #0a0a0a;
            color: #c0c0c0;
            font-family: 'Cascadia Code', 'Fira Code', 'Consolas', 'Monaco', 'Liberation Mono', monospace;
            font-size: 14px;
            line-height: 1.2;
            padding: 20px;
            margin: 0;
        }
        pre {
            margin: 0;
            white-space: pre;
            overflow-x: auto;
        }
        .bold { font-weight: bold; }
        .dim { opacity: 0.7; }
        .italic { font-style: italic; }
        .underline { text-decoration: underline; }
        .blink { animation: blink 1s step-end infinite; }
        .reverse { filter: invert(1); }
        @keyframes blink {
            50% { opacity: 0; }
        }
        .timestamp {
            color: #666;
            font-size: 12px;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="timestamp">Captured: `)
	sb.WriteString(time.Now().Format("2006-01-02 15:04:05"))
	sb.WriteString(`</div>
    <pre>`)

	// Parse and convert ANSI sequences
	sb.WriteString(parseANSI(content))

	// Write HTML footer
	sb.WriteString(`</pre>
</body>
</html>`)

	return sb.String()
}

// parseANSI parses ANSI escape sequences and converts to HTML spans
func parseANSI(content string) string {
	var result strings.Builder
	var currentFg, currentBg string
	var bold, dim, italic, underline, blink, reverse bool

	// ANSI escape sequence regex
	ansiRegex := regexp.MustCompile(`\x1b\[([0-9;]*)m`)

	i := 0
	for i < len(content) {
		// Check for escape sequence
		if i+1 < len(content) && content[i] == '\x1b' && content[i+1] == '[' {
			// Find end of sequence
			loc := ansiRegex.FindStringIndex(content[i:])
			if loc != nil {
				match := ansiRegex.FindStringSubmatch(content[i:])
				if len(match) > 1 {
					codes := strings.Split(match[1], ";")
					processCodes(codes, &currentFg, &currentBg, &bold, &dim, &italic, &underline, &blink, &reverse)
				}
				i += loc[1]
				continue
			}
		}

		// Write the character with current style
		char := string(content[i])

		// HTML escape
		char = html.EscapeString(char)

		// Apply styling
		if currentFg != "" || currentBg != "" || bold || dim || italic || underline || blink || reverse {
			result.WriteString(buildSpan(char, currentFg, currentBg, bold, dim, italic, underline, blink, reverse))
		} else {
			result.WriteString(char)
		}

		i++
	}

	return result.String()
}

// processCodes processes ANSI SGR codes and updates state
func processCodes(codes []string, fg, bg *string, bold, dim, italic, underline, blink, reverse *bool) {
	i := 0
	for i < len(codes) {
		code := codes[i]

		switch code {
		case "0", "":
			// Reset
			*fg = ""
			*bg = ""
			*bold = false
			*dim = false
			*italic = false
			*underline = false
			*blink = false
			*reverse = false
		case "1":
			*bold = true
		case "2":
			*dim = true
		case "3":
			*italic = true
		case "4":
			*underline = true
		case "5":
			*blink = true
		case "7":
			*reverse = true
		case "22":
			*bold = false
			*dim = false
		case "23":
			*italic = false
		case "24":
			*underline = false
		case "25":
			*blink = false
		case "27":
			*reverse = false
		case "30":
			*fg = ansiColorMap["0"]
		case "31":
			*fg = ansiColorMap["1"]
		case "32":
			*fg = ansiColorMap["2"]
		case "33":
			*fg = ansiColorMap["3"]
		case "34":
			*fg = ansiColorMap["4"]
		case "35":
			*fg = ansiColorMap["5"]
		case "36":
			*fg = ansiColorMap["6"]
		case "37":
			*fg = ansiColorMap["7"]
		case "38":
			// 256/24-bit color foreground
			if i+1 < len(codes) && codes[i+1] == "5" && i+2 < len(codes) {
				if color, ok := ansiColorMap[codes[i+2]]; ok {
					*fg = color
				}
				i += 2
			} else if i+1 < len(codes) && codes[i+1] == "2" && i+4 < len(codes) {
				// 24-bit color
				*fg = fmt.Sprintf("#%02x%02x%02x", atoi(codes[i+2]), atoi(codes[i+3]), atoi(codes[i+4]))
				i += 4
			}
		case "39":
			*fg = ""
		case "40":
			*bg = ansiColorMap["0"]
		case "41":
			*bg = ansiColorMap["1"]
		case "42":
			*bg = ansiColorMap["2"]
		case "43":
			*bg = ansiColorMap["3"]
		case "44":
			*bg = ansiColorMap["4"]
		case "45":
			*bg = ansiColorMap["5"]
		case "46":
			*bg = ansiColorMap["6"]
		case "47":
			*bg = ansiColorMap["7"]
		case "48":
			// 256/24-bit color background
			if i+1 < len(codes) && codes[i+1] == "5" && i+2 < len(codes) {
				if color, ok := ansiColorMap[codes[i+2]]; ok {
					*bg = color
				}
				i += 2
			} else if i+1 < len(codes) && codes[i+1] == "2" && i+4 < len(codes) {
				// 24-bit color
				*bg = fmt.Sprintf("#%02x%02x%02x", atoi(codes[i+2]), atoi(codes[i+3]), atoi(codes[i+4]))
				i += 4
			}
		case "49":
			*bg = ""
		case "90":
			*fg = ansiColorMap["8"]
		case "91":
			*fg = ansiColorMap["9"]
		case "92":
			*fg = ansiColorMap["10"]
		case "93":
			*fg = ansiColorMap["11"]
		case "94":
			*fg = ansiColorMap["12"]
		case "95":
			*fg = ansiColorMap["13"]
		case "96":
			*fg = ansiColorMap["14"]
		case "97":
			*fg = ansiColorMap["15"]
		case "100":
			*bg = ansiColorMap["8"]
		case "101":
			*bg = ansiColorMap["9"]
		case "102":
			*bg = ansiColorMap["10"]
		case "103":
			*bg = ansiColorMap["11"]
		case "104":
			*bg = ansiColorMap["12"]
		case "105":
			*bg = ansiColorMap["13"]
		case "106":
			*bg = ansiColorMap["14"]
		case "107":
			*bg = ansiColorMap["15"]
		}
		i++
	}
}

// buildSpan builds an HTML span with styles
func buildSpan(char, fg, bg string, bold, dim, italic, underline, blink, reverse bool) string {
	var styles []string
	var classes []string

	if fg != "" {
		styles = append(styles, "color:"+fg)
	}
	if bg != "" {
		styles = append(styles, "background-color:"+bg)
	}
	if bold {
		classes = append(classes, "bold")
	}
	if dim {
		classes = append(classes, "dim")
	}
	if italic {
		classes = append(classes, "italic")
	}
	if underline {
		classes = append(classes, "underline")
	}
	if blink {
		classes = append(classes, "blink")
	}
	if reverse {
		classes = append(classes, "reverse")
	}

	var sb strings.Builder
	sb.WriteString("<span")
	if len(classes) > 0 {
		sb.WriteString(` class="`)
		sb.WriteString(strings.Join(classes, " "))
		sb.WriteString(`"`)
	}
	if len(styles) > 0 {
		sb.WriteString(` style="`)
		sb.WriteString(strings.Join(styles, ";"))
		sb.WriteString(`"`)
	}
	sb.WriteString(">")
	sb.WriteString(char)
	sb.WriteString("</span>")

	return sb.String()
}

// atoi converts string to int (returns 0 on error)
func atoi(s string) int {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return n
		}
		n = n*10 + int(c-'0')
	}
	return n
}
