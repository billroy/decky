
## Instant bugs
- t2 test item still shows the label I entered, "Test",  overwriting t2
- none of the color pickers work - nothing happens
- Theme selector comes up preset to "light" even though "dark" is selected
- Using the theme selector does nothing
- I thought this tranche included an icon selection feature but I do not see it
- I thought this tranche included both default page colors and per-icon colors.  All I see is something entitled "default colors"


## Feature: multi provider support
The idea is to expand support beyond Claude to other providers
Support routing commands, selectable per-macro, to this list of providers:
	Claude, Codex, ChatGPT, Cursor, Windsurf
Proposed ui:
- add a dropdown selector with the app names to pick one
- default to Claude
- add a checkbox to show/hide a small target app indicator tag on the icon
	- Proposal for optional visual command target indicator: tiny text at the top left of the icon in the smallest type you can find (8 pt?)
		- Claude=CLD, codex=CDX, etc.  make up 3-letter abbreviations
	- Consider and propose other options
Backend button-press dispatch should select which app to activate based on the dropdown
Persist to config.json
Review this proposal and suggest issues and enhancements.

## Feature enhancement: periodically updating information widgets
Add a new type of button that is periodically updated with new information.
First one to explore is a token usage indicator.  Is this feasible?  Investigate and report.
- For Claude, the idea would be to add a button that is updated to display %current session/%current week stacked vertically with the background %-colorcoded >80% yellow and >90% red.  Or similar, review and make recommendation.
- refresh options should be "on click" or time interval with user specified time in minutes.
- Investigate what usage or token consumption metrics are applicable to / available from the other providers and produce a proposal.
- This may be a non-starter if the apps don't provide a way to extract the usage information.
- make a proposal for periodically updating widgets anyway.  perhaps you can suggest interesting metrics.  AI backend status, perhaps.

## Way to Click the Approve Once Button Or Press Return
I would REALLY like to not have to switch to claude manually to click the "approve once" button.  This function is available in claude.app by sending the Enter key if the app is focused.  See if there is a way to do that.  Maybe even just an empty prompt that sends no prompt text followed by a \n?  We could document that, or add a new button type.  Recommend.

## Slash commands
Investigate whether slash commands work from the claude code text box. Can we configure prompts to do slash commands?  If not, what would it take?

## Talk to claude
- idea: click a button, claude goes into speech input mode.  propose a way to activate dictation to claude.  may require a new button type

## Remove edit feature
- the property inspector makes it unnecessary to edit config.json manually
- remove the edit feature and the editor selector
- this will be a doc fix.
- unconfigured buttons should no-op
- consider: maybe open a browser to the README?

## Security review
Review the document @codex-security-analysis.md and then perform your own security review.   Include in this work bundle a plan to confirm and address all the valid issues above Low priority.

## README update
- Update the readme setup instructions to reflect the property inspector and details about each control
- Include screenshots if possible


Ensure the plan is staged into 20-minute chunks with checkpoint/plan update/commit each stage.



