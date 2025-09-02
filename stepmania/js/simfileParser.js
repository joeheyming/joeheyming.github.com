// Simfile Parser for .sm files
class SimfileParser {
  constructor() {
    this.reset();
  }

  reset() {
    this.metadata = {};
    this.charts = [];
    this.bpmChanges = [];
    this.bgChanges = [];
  }

  parse(simfileContent) {
    this.reset();

    // Remove comments and normalize line endings
    const cleanContent = simfileContent
      .replace(/\/\/.*$/gm, '') // Remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // Parse metadata
    this.parseMetadata(cleanContent);

    // Parse BPM changes
    this.parseBPMs(cleanContent);

    // Parse background changes
    this.parseBGChanges(cleanContent);

    // Parse charts
    this.parseCharts(cleanContent);

    return {
      title: this.metadata.TITLE || 'Unknown',
      artist: this.metadata.ARTIST || 'Unknown',
      bpm: this.getDisplayBPM(),
      offset: this.parseOffset(),
      charts: this.charts,
      bgChanges: this.bgChanges,
      bpmChanges: this.bpmChanges,
      metadata: this.metadata
    };
  }

  parseMetadata(content) {
    // Match #TAG:VALUE; patterns
    const metadataRegex = /#([A-Z]+):([^;]+);/g;
    let match;

    while ((match = metadataRegex.exec(content)) !== null) {
      const tag = match[1];
      const value = match[2].trim();
      this.metadata[tag] = value;
    }
  }

  parseBPMs(content) {
    const bpmMatch = content.match(/#BPMS:([^;]+);/);
    if (bpmMatch) {
      const bpmString = bpmMatch[1];
      const bpmPairs = bpmString.split(',');

      this.bpmChanges = bpmPairs.map((pair) => {
        const [beat, bpm] = pair.split('=').map((s) => parseFloat(s.trim()));
        return { beat, bpm };
      });
    }

    // Sort by beat
    this.bpmChanges.sort((a, b) => a.beat - b.beat);
  }

  parseBGChanges(content) {
    const bgMatch = content.match(/#BGCHANGES:([^;]+);/);
    if (bgMatch) {
      const bgString = bgMatch[1];
      const bgPairs = bgString.split(',');

      this.bgChanges = bgPairs
        .map((pair) => {
          const parts = pair.split('=').map((s) => s.trim());
          if (parts.length >= 4) {
            const beat = parseFloat(parts[0]);
            const file = parts[1];
            const effect = parts[2];
            const x = parseFloat(parts[3]) || 0;
            const y = parseFloat(parts[4]) || 0;

            return {
              beat,
              file,
              effect,
              x,
              y,
              // Determine if this is a video file
              isVideo:
                file.toLowerCase().endsWith('.avi') ||
                file.toLowerCase().endsWith('.mp4') ||
                file.toLowerCase().endsWith('.webm') ||
                file.toLowerCase().endsWith('.mov'),
              // Determine if this is a "no background" command
              isNoBackground: file === '-nosongbg-'
            };
          }
          return null;
        })
        .filter((bg) => bg !== null);
    }

    // Sort by beat
    this.bgChanges.sort((a, b) => a.beat - b.beat);
  }

  parseCharts(content) {
    // Find all #NOTES blocks
    const notesRegex =
      /#NOTES:\s*([^:]+):\s*([^:]*):\s*([^:]+):\s*([^:]+):\s*([^:]*):?\s*([\s\S]*?)(?=#NOTES:|$)/g;
    let match;

    while ((match = notesRegex.exec(content)) !== null) {
      const chartType = match[1].trim();
      const description = match[2].trim();
      const difficulty = match[3].trim();
      const rating = parseInt(match[4].trim());
      const radarValues = match[5].trim();
      const stepData = match[6].trim();

      // Only process dance-single charts for now
      if (chartType === 'dance-single') {
        const noteData = this.parseStepData(stepData);

        this.charts.push({
          type: chartType,
          description,
          difficulty,
          rating,
          radarValues,
          noteData
        });
      }
    }
  }

  parseStepData(stepData) {
    const notes = [];

    // Split into measures (separated by commas)
    const measures = stepData
      .split(',')
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    let currentBeat = 0;

    for (const measure of measures) {
      const lines = measure.split(/\s+/).filter((line) => line.length === 4);

      if (lines.length === 0) {
        currentBeat += 4; // Empty measure
        continue;
      }

      const beatsPerLine = 4 / lines.length;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineBeat = currentBeat + lineIndex * beatsPerLine;

        // Process each column (Left, Down, Up, Right in simfile = 0,1,2,3)
        // Convert to our format: 0=left, 1=down, 2=up, 3=right
        for (let col = 0; col < 4; col++) {
          const noteType = line[col];

          if (noteType !== '0') {
            const noteProps = {};

            // Handle different note types
            switch (noteType) {
              case '1': // Tap note
                break;
              case '2': // Hold start
                noteProps.Type = 2;
                noteProps.SubType = 0;
                // Try to find hold end
                const holdEnd = this.findHoldEnd(
                  measures,
                  measure,
                  lineIndex,
                  lines.length,
                  col,
                  currentBeat
                );
                if (holdEnd > lineBeat) {
                  noteProps.Duration = Math.round((holdEnd - lineBeat) * 48); // Convert to ticks
                }
                break;
              case '3': // Hold end (handled by hold start)
                continue;
              case '4': // Roll start
                noteProps.Type = 4;
                noteProps.SubType = 0;
                break;
              case 'M': // Mine
                noteProps.Type = 'M';
                break;
              default:
                break;
            }

            notes.push([lineBeat, col, noteProps]);
          }
        }
      }

      currentBeat += 4; // Move to next measure
    }

    return notes;
  }

  findHoldEnd(measures, currentMeasure, startLineIndex, linesPerMeasure, column, measureStartBeat) {
    const allLines = [];
    let beatOffset = 0;

    // Collect all lines from all measures
    for (const measure of measures) {
      const lines = measure.split(/\s+/).filter((line) => line.length === 4);
      if (lines.length > 0) {
        const beatsPerLine = 4 / lines.length;
        for (let i = 0; i < lines.length; i++) {
          allLines.push({
            line: lines[i],
            beat: beatOffset + i * beatsPerLine
          });
        }
      }
      beatOffset += 4;
    }

    // Find the starting position
    const startBeat = measureStartBeat + startLineIndex * (4 / linesPerMeasure);
    let startIndex = -1;

    for (let i = 0; i < allLines.length; i++) {
      if (Math.abs(allLines[i].beat - startBeat) < 0.001) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === -1) return startBeat;

    // Look for hold end (3) in the same column
    for (let i = startIndex + 1; i < allLines.length; i++) {
      const line = allLines[i];
      if (line.line[column] === '3') {
        return line.beat;
      }
    }

    return startBeat;
  }

  getDisplayBPM() {
    if (this.metadata.DISPLAYBPM) {
      const bpm = parseFloat(this.metadata.DISPLAYBPM);
      if (!isNaN(bpm)) return bpm;
    }

    // Fall back to first BPM change
    if (this.bpmChanges.length > 0) {
      return this.bpmChanges[0].bpm;
    }

    return 120; // Default
  }

  parseOffset() {
    if (this.metadata.OFFSET) {
      return parseFloat(this.metadata.OFFSET);
    }
    return 0;
  }

  // Helper method to convert beat to seconds with BPM changes
  beatToSeconds(beat) {
    let seconds = 0;
    let currentBeat = 0;
    let currentBPM = this.bpmChanges[0]?.bpm || 120;

    for (const bpmChange of this.bpmChanges) {
      if (bpmChange.beat <= beat) {
        // Add time for the segment with the previous BPM
        const segmentBeats = bpmChange.beat - currentBeat;
        seconds += (segmentBeats / currentBPM) * 60;

        currentBeat = bpmChange.beat;
        currentBPM = bpmChange.bpm;
      } else {
        break;
      }
    }

    // Add remaining time with current BPM
    const remainingBeats = beat - currentBeat;
    seconds += (remainingBeats / currentBPM) * 60;

    return seconds;
  }
}

// Make globally accessible
window.SimfileParser = SimfileParser;
