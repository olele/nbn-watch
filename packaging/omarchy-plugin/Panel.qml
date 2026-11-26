import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// NBN Watch bar widget: icon + hover summary + click popup, styled like the
// built-in network/power widgets. Data comes from the NBN Watch app, which
// writes ~/.config/nbn-watch/status.json on every check.
Panel {
  id: root
  moduleName: "nbnwatch.status"
  ipcTarget: "nbnwatch.status"

  property var status: ({})
  readonly property string level: status.level || "missing"
  readonly property bool problem: level === "down" || level === "mobile" || level === "degraded"
  readonly property string statusPath: Quickshell.env("HOME") + "/.config/nbn-watch/status.json"
  readonly property string appPath: Quickshell.env("HOME") + "/.local/bin/nbn-watch"

  readonly property string glyph: {
    switch (level) {
      case "ok": return "\u{F059F}"        // web
      case "mobile": return "\u{F08BC}"    // cellular: on 4G backup
      case "down": return "\u{F0A8E}"      // web off
      case "degraded": return "\u{F0026}"  // alert
      case "planned": return "\u{F00F0}"   // calendar clock
      case "checking": return "\u{F0453}"  // refresh
      default: return "\u{F0625}"          // help (setup / app not running)
    }
  }
  readonly property string headline: level === "missing" ? "NBN Watch not running" : (status.headline || "NBN Watch")
  readonly property var rows: status.rows || []

  function plain(text) {
    // Drop the leading emoji the app puts on labels; the bar font is monochrome.
    return String(text || "").replace(/^[^A-Za-z0-9(]+\s*/, "")
  }

  function tooltip() {
    var parts = [headline]
    var d = status.details || []
    for (var i = 0; i < d.length && i < 3; i++) parts.push(plain(d[i]))
    if (status.checked_at) parts.push("checked " + status.checked_at)
    return parts.join("\n")
  }

  FileView {
    id: statusFile
    path: root.statusPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try { root.status = JSON.parse(text()) } catch (e) { root.status = ({}) }
    }
    onLoadFailed: root.status = ({})
  }

  Process { id: runner }
  function run(args) {
    runner.command = args
    runner.running = true
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.glyph
    foreground: root.problem ? Commons.Color.urgent : (root.bar ? root.bar.barForeground : Commons.Color.foreground)
    tooltipText: root.opened ? "" : root.tooltip()
    onPressed: function(b) {
      if (b === Qt.RightButton) root.run([root.appPath, "--open"])
      else if (b === Qt.MiddleButton) root.run([root.appPath, "--check"])
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: parent.top
        spacing: Style.space(14)

        // ---------- Hero: icon · NBN / status · checked time ----------
        Item {
          width: parent.width
          implicitHeight: Math.max(heroIcon.implicitHeight, heroLabels.implicitHeight)

          Text {
            id: heroIcon
            textFormat: Text.PlainText
            text: root.glyph
            color: root.problem ? Commons.Color.urgent : root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.display
            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
          }

          Column {
            id: heroLabels
            anchors.left: heroIcon.right
            anchors.leftMargin: Style.space(14)
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Text {
              text: "NBN"
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.title
              font.bold: true
            }
            Text {
              textFormat: Text.PlainText
              text: root.headline.toUpperCase()
              color: root.problem ? Commons.Color.urgent : Qt.darker(root.bar.foreground, 1.4)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              font.letterSpacing: 1.2
              elide: Text.ElideRight
              width: parent.width
            }
          }
        }

        PanelSeparator { foreground: root.bar.foreground }

        // ---------- Details from the app ----------
        Column {
          width: parent.width
          spacing: Style.spacing.labelGap
          visible: root.rows.length > 0

          Repeater {
            model: root.rows
            InfoPair {
              required property var modelData
              label: root.plain(modelData[0])
              value: String(modelData[1] || "")
            }
          }
        }

        Text {
          visible: root.rows.length === 0
          width: parent.width
          wrapMode: Text.WordWrap
          textFormat: Text.PlainText
          text: root.level === "missing"
            ? "Start NBN Watch to see your NBN status here."
            : "Finish setup in NBN Watch to start monitoring."
          color: root.bar.foreground
          opacity: 0.7
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.bodySmall
        }

        Text {
          visible: !!root.status.checked_at
          textFormat: Text.PlainText
          text: "Checked " + (root.status.checked_at || "") + " · every 5 minutes"
          color: root.bar.foreground
          opacity: 0.5
          font.family: root.bar.fontFamily
          font.pixelSize: Style.font.caption
        }

        // ---------- Actions ----------
        Row {
          id: actions
          width: parent.width
          spacing: Style.space(6)
          readonly property real cellWidth: (width - spacing) / 2

          Button {
            width: actions.cellWidth
            iconText: "\u{F0453}"
            text: "Check now"
            fontSize: Style.font.bodySmall
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
            bordered: true
            onClicked: root.run([root.appPath, "--check"])
          }
          Button {
            width: actions.cellWidth
            iconText: "\u{F0493}"
            text: "Settings"
            fontSize: Style.font.bodySmall
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            horizontalPadding: Style.spacing.controlPaddingX
            verticalPadding: Style.spacing.controlPaddingY + Style.space(2)
            bordered: true
            onClicked: { root.close(); root.run([root.appPath, "--open"]) }
          }
        }
      }
    }
  }

  component InfoPair: Row {
    property string label: ""
    property string value: ""

    width: parent.width
    spacing: Style.space(8)

    InfoLabel { id: l; text: label }
    Item { width: Math.max(0, parent.width - l.implicitWidth - v.implicitWidth - parent.spacing * 2); height: 1 }
    InfoValue { id: v; text: value; width: Math.min(implicitWidth, parent.width * 0.68); elide: Text.ElideRight; horizontalAlignment: Text.AlignRight }
  }

  component InfoLabel: Text {
    textFormat: Text.PlainText
    color: root.bar.foreground
    opacity: 0.6
    font.family: root.bar.fontFamily
    font.pixelSize: Style.font.bodySmall
  }

  component InfoValue: Text {
    textFormat: Text.PlainText
    color: root.bar.foreground
    font.family: root.bar.fontFamily
    font.pixelSize: Style.font.bodySmall
  }
}
