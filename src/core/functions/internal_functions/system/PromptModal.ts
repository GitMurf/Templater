import { TemplaterError } from "utils/Error";
import {
    App,
    ButtonComponent,
    Modal,
    Platform,
    Scope,
    TextAreaComponent,
    TextComponent,
    TFile,
// } from "../../../../../node_modules/obsidian";
} from "obsidian";

export class PromptModal extends Modal {
    private resolve: (value: string) => void;
    private reject: (reason?: TemplaterError) => void;
    private submitted = false;
    textArea: TextAreaComponent;
    value: string;
    private app: App;
    private pageCompleteSuggester: PageAutocomplete;
    scope: Scope;

    constructor(
        app: App,
        private prompt_text: string,
        private default_value: string,
        private multi_line: boolean
    ) {
        super(app);
        this.app = app;
        this.scope = new Scope();
        // this.scope.register([], "Escape", this.keyPress.bind(this, "Escape"));
    }

    keyPress(keyType: string, evt: KeyboardEvent) {
        switch (keyType) {
            case "ArrowDown":
                break;
            case "ArrowUp":
                break;
            case "Enter":
                this.enterCallback(evt);
                break;
            case "Escape":
                this.close();
                break;
        }
    }

    onOpen(): void {
        this.titleEl.setText(this.prompt_text);
        this.createForm();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.submitted) {
            // TOFIX: for some reason throwing TemplaterError on iOS causes the app to freeze.
            // this.reject(new TemplaterError("Cancelled prompt"));
            this.reject();
        }
        this.pageCompleteSuggester.suggestContainer.detach();
    }

    createForm(): void {
        const div = this.contentEl.createDiv();
        div.addClass("templater-prompt-div");
        let textInput;
        if (this.multi_line) {
            textInput = new TextAreaComponent(div);
            this.textArea = textInput;

            // Add submit button since enter needed for multiline input on mobile
            const buttonDiv = this.contentEl.createDiv();
            buttonDiv.addClass("templater-button-div");
            const submitButton = new ButtonComponent(buttonDiv);
            submitButton.buttonEl.addClass("mod-cta");
            submitButton.setButtonText("Submit").onClick((evt: Event) => {
                this.resolveAndClose(evt);
            });
        } else {
            textInput = new TextComponent(div);

            textInput.inputEl.addEventListener("keydown", (evt: KeyboardEvent) =>
                this.enterCallback(evt)
            );
        }

        this.value = this.default_value ?? "";
        textInput.inputEl.addClass("templater-prompt-input");
        textInput.setPlaceholder("Type text here");
        textInput.setValue(this.value);


        function debounce(func: Function, timeout = 300) {
            let timer: number;
            return (...args: any[]) => {
                clearTimeout(timer);
                timer = window.setTimeout(() => { func.apply(this, args); }, timeout);
            };
        }

        const modalEl = div.parentElement.parentElement;
        this.pageCompleteSuggester = new PageAutocomplete(this.app, this, modalEl, this.scope);
        const lookupPage = (val: string) => this.pageCompleteSuggester.pageLookup(val);
        const debouncedLookup = debounce(lookupPage, 300);

        textInput.onChange((value: string) => {
            this.value = value;
            debouncedLookup(value);
        });
    }

    enterCallback(evt: KeyboardEvent) {
        if (this.multi_line) {
            if (Platform.isDesktop) {
                if (evt.shiftKey && evt.key === "Enter") {
                } else if (evt.key === "Enter") {
                    this.resolveAndClose(evt);
                }
            } else {
                // allow pressing enter on mobile for multi-line input
                if (evt.key === "Enter") {
                    evt.preventDefault();
                }
            }
        } else {
            if (evt.key === "Enter") {
                this.resolveAndClose(evt);
            }
        }
    }

    private resolveAndClose(evt: Event | KeyboardEvent) {
        this.submitted = true;
        evt.preventDefault();
        this.resolve(this.value);
        this.close();
    }

    async openAndGetValue(
        resolve: (value: string) => void,
        reject: (reason?: TemplaterError) => void
    ): Promise<void> {
        this.resolve = resolve;
        this.reject = reject;
        this.open();
    }
}

class PageAutocomplete {
    promptModal: PromptModal;
    suggestContainer: HTMLDivElement;
    suggestEl: HTMLDivElement;
    allLinkOptions: { name: string; path: string }[];
    allLinkMatches: { name: string; path: string }[];
    matchPageBrackets: RegExpMatchArray;
    // scope: Scope;

    constructor(app: App, prompt: PromptModal, modalEl: HTMLDivElement, scope: Scope) {
        this.promptModal = prompt;
        this.suggestContainer = createDiv({ cls: "suggestion-container" });
        this.suggestContainer.style.display = "none";
        this.suggestEl = this.suggestContainer.createDiv({ cls: "suggestion" });
        this.suggestEl.on("mousemove", '.suggestion-item', (evt: MouseEvent) => {
            // console.log("mousemove:", evt.target);
            if (evt.target instanceof HTMLDivElement) {
                if (evt.target.classList.contains("suggestion-item")) {
                    const oldSelected = evt.target.parentElement.querySelector('.is-selected');
                    if(oldSelected) oldSelected.classList.remove("is-selected");
                    evt.target.classList.add("is-selected");
                }
            }
        });
        this.allLinkOptions = this.getLinkOptions(app);
        this.setSize(modalEl);
        document.body.append(this.suggestContainer);
        // this.scope = new Scope();
        scope.register([], "Escape", (evt: KeyboardEvent) => {
            this.keyPress("Escape", evt);
        });
        scope.register([], "ArrowDown", (evt: KeyboardEvent) => {
            this.keyPress("ArrowDown", evt);
        });
        scope.register([], "ArrowUp", (evt: KeyboardEvent) => {
            this.keyPress("ArrowUp", evt);
        });
        scope.register([], "Enter", (evt: KeyboardEvent) => {
            this.keyPress("Enter", evt);
        });
    }

    pageLookup(val: string) {
        this.allLinkMatches = [];
        const matchBrackets = val.match(/(.*\[\[)([^\]]+)$/);
        if (matchBrackets) {
            this.matchPageBrackets = matchBrackets;
            const matchString = matchBrackets[2];
            if (matchString.trim().length > 1) {
                // console.log(matchString);
                this.findExact(matchString);
                this.findStart(matchString);
                this.findContains(matchString);
                this.findSpaces(matchString);
                this.findWildcard(matchString);
                this.findFuzzyWords(matchString);
                // this.findFuzzyCharacters(matchString);
                // let uniq: { name: string; path: string }[] = Array.from(new Set(this.allLinkMatches));
                let uniqueTracker: string[] = [];
                let uniq = this.allLinkMatches.filter((item) => {
                    if (uniqueTracker.includes(item.path + item.name)) {
                        return false;
                    } else {
                        uniqueTracker.push(item.path + item.name);
                        return true;
                    }
                });
                // console.log(uniq);
                this.allLinkMatches = uniq;
                if (this.allLinkMatches.length > 0) {
                    this.setOptions();
                    this.suggestContainer.style.display = "block";
                } else {
                    this.clear();
                }
            } else {
                this.clear();
            }
        } else {
            this.clear();
        }
    }

    findExact(val: string) {
        const valString = val.toLowerCase();
        const foundMatches = this.allLinkOptions.find(eachLink => eachLink.name.toLowerCase() === valString);
        if (foundMatches) this.allLinkMatches.push(foundMatches);
        // console.log(foundMatches);
    }

    findStart(val: string) {
        const valString = val.toLowerCase();
        const foundMatches = this.allLinkOptions.filter(eachLink => eachLink.name.toLowerCase().startsWith(valString));
        if (foundMatches) this.sortAndAdd(foundMatches);
    }

    findContains(val: string) {
        const valString = val.toLowerCase();
        const foundMatches = this.allLinkOptions.filter(eachLink => eachLink.name.toLowerCase().indexOf(valString) > -1);
        if (foundMatches) this.sortAndAdd(foundMatches);
    }

    findSpaces(val: string) {
        const valString = val.toLowerCase().replace(/[\s\-\.\_]/g, "");
        const foundMatches = this.allLinkOptions.filter(eachLink => eachLink.name.toLowerCase().replace(/[\s\-\.\_]/g, "").indexOf(valString) > -1);
        if (foundMatches) this.sortAndAdd(foundMatches);
    }

    findWildcard(val: string) {
        const valString = this.escapeRegExp(val.toLowerCase());
        const regExp = new RegExp(`${valString.replace(/\./g, "..*").replace(/\s+/g, ".*")}`, "i");
        // console.log(regExp);
        const foundMatches = this.allLinkOptions.filter(eachLink => eachLink.name.match(regExp));
        if (foundMatches) this.sortAndAdd(foundMatches);
    }

    findFuzzyWords(val: string) {
        const valString = val.toLowerCase();
        const splitWords = valString.split(" ");
        const foundMatches = this.allLinkOptions.filter(eachLink => {
            const eachLinkLower = eachLink.name.toLowerCase();
            let foundAllWords = true;
            splitWords.forEach(eachWord => {
                if (foundAllWords) {
                    if (eachLinkLower.indexOf(eachWord) < 0) {
                        foundAllWords = false;
                    }
                }
            })
            if (foundAllWords) {
                return true;
            } else {
                return false;
            }
        });
        if (foundMatches) this.sortAndAdd(foundMatches);
    }

    findFuzzyCharacters(val: string) {
        const valString = val.toLowerCase();
        let newRegexFuzzyStr = "";
        for (const char of valString) {
            if (char !== " ") {
                newRegexFuzzyStr += `${this.escapeRegExp(char)}.*`;
            }
        }
        const regExp = new RegExp(`${newRegexFuzzyStr}`, "i");
        // console.log(regExp);
        const foundMatches = this.allLinkOptions.filter(eachLink => eachLink.name.match(regExp));
        if (foundMatches) this.sortAndAdd(foundMatches);
    }

    sortAndAdd(foundMatches: { name: string; path: string }[]) {
        // sort by length as typically the shorter the word/phrase the more relevant to the user
        foundMatches.sort((a, b) => a.name.length - b.name.length);
        this.allLinkMatches.push(...foundMatches);
        // console.log(foundMatches);
    }

    getLinkOptions(app: App) {
        const files = app.vault.getMarkdownFiles();
        let links: { name: string;  path: string }[] = [];
        files.forEach((file: TFile) => {
            links.push({ name: file.basename, path: file.path });
        });
        let unresolvedLinkUniq: string[] = [];
        const unResLinks = Object.values(Object.fromEntries(Object.entries(app.metadataCache.unresolvedLinks)));
        unResLinks.forEach((eachItem) => {
            let theValues = Object.keys(eachItem);
            if (theValues.length > 0) {
                theValues.forEach(eachLink => {
                    if (!unresolvedLinkUniq.includes(eachLink)) {
                        unresolvedLinkUniq.push(eachLink);
                        links.push({ name: eachLink, path: "Unresolved" });
                    } else {
                        // console.log("already exists");
                    }
                })
            }
        });
        // let uniq: { name: string; path: string }[] = Array.from(new Set(links));
        return links;
    }

    setOptions() {
        this.suggestEl.empty();
        this.allLinkMatches.forEach((eachMatch) => {
            this.addItemDiv(eachMatch);
        });
        let curSelected = this.suggestEl.querySelector('.is-selected');
        if (!curSelected) {
            if (this.suggestEl.children.length > 0) {
                this.suggestEl.children[0].classList.add('is-selected');
                this.suggestEl.children[0].scrollIntoView(false);
            }
        }
    }

    addItemDiv(linkObject: { name: string; path: string }) {
        const tmp1 = this.suggestEl.createDiv({ cls: "suggestion-item mod-complex" });
        //add click event
        tmp1.addEventListener("click", () => {
            this.updateTextWithSelectedPage(linkObject.name);
        });
        const tmp2 = tmp1.createDiv({ cls: "suggestion-content" });
        const tmp3 = tmp2.createDiv({ cls: "suggestion-title" });
        const tmp4 = tmp3.createSpan({ text: linkObject.name, cls: "suggestion-highlight" });
        const tmp5 = tmp2.createDiv({ text: linkObject.path, cls: "suggestion-note" });
        const tmp6 = tmp1.createDiv({ cls: "suggestion-aux" });
    }

    updateTextWithSelectedPage(pageName: string) {
        const curValue = `${this.promptModal.textArea.inputEl.value}`;
        const beforePageBrackets = this.matchPageBrackets[1];
        const newValue = `${beforePageBrackets}${pageName}]]`;
        this.promptModal.textArea.setValue(newValue);
        this.promptModal.value = newValue;
        const endPos = this.promptModal.textArea.inputEl.value.length;
        this.promptModal.textArea.inputEl.setSelectionRange(endPos, endPos);
        this.promptModal.textArea.inputEl.focus();
        this.clear();
    }

    setSize(modalEl: HTMLDivElement) {
        this.suggestContainer.style.width = `${modalEl.offsetWidth}px`;
        this.suggestContainer.style.maxWidth = `${modalEl.offsetWidth}px`;
        this.suggestContainer.style.left = `${modalEl.offsetLeft}px`;
        this.suggestContainer.style.top = `${modalEl.offsetTop + modalEl.offsetHeight}px`;
    }

    escapeRegExp(text: string) {
        return text.replace(/[\-\[\]\{\}\(\)\*\+\?\.\,\\\^\$\|\#]/g, '\\$&');
    }

    keyPress(keyType: string, evt: KeyboardEvent) {
        switch (keyType) {
            case "ArrowDown":
                evt.preventDefault();
                // this.promptModal.keyPress(keyType, evt);
                let curSelected = this.suggestEl.querySelector('.is-selected');
                if (!curSelected) {
                    if (this.suggestEl.children.length > 0) {
                        this.suggestEl.children[0].classList.add('is-selected');
                        this.suggestEl.children[0].scrollIntoView(false);
                    }
                } else {
                    curSelected.classList.remove('is-selected');
                    if (curSelected.nextElementSibling) {
                        curSelected.nextElementSibling.classList.add('is-selected');
                        curSelected.nextElementSibling.scrollIntoView(false);
                    } else {
                        this.suggestEl.children[0].classList.add('is-selected');
                        this.suggestEl.children[0].scrollIntoView(false);
                    }
                }
                break;
            case "ArrowUp":
                evt.preventDefault();
                // this.promptModal.keyPress(keyType, evt);
                let curSelected2 = this.suggestEl.querySelector('.is-selected');
                if (!curSelected2) {
                    if (this.suggestEl.children.length > 0) {
                        this.suggestEl.children[this.suggestEl.children.length - 1].classList.add('is-selected');
                        this.suggestEl.children[this.suggestEl.children.length - 1].scrollIntoView(false);
                    }
                } else {
                    curSelected2.classList.remove('is-selected');
                    if (curSelected2.previousElementSibling) {
                        curSelected2.previousElementSibling.classList.add('is-selected');
                        curSelected2.previousElementSibling.scrollIntoView(false);
                    } else {
                        this.suggestEl.children[this.suggestEl.children.length - 1].classList.add('is-selected');
                        this.suggestEl.children[this.suggestEl.children.length - 1].scrollIntoView(false);
                    }
                }
                break;
            case "Enter":
                evt.preventDefault();
                if (this.isHidden()) {
                    // this.promptModal.enterCallback(evt);
                    this.promptModal.keyPress(keyType, evt);
                } else {
                    const curSelected = this.suggestEl.querySelector('.is-selected');
                    if (curSelected instanceof HTMLElement) {
                        curSelected.click();
                    }
                    this.clear();
                }
                break;
            case "Escape":
                evt.preventDefault();
                if (this.isHidden()) {
                    this.promptModal.keyPress(keyType, evt);
                } else {
                    this.clear();
                }
                break;
        }
    }

    isHidden(): boolean {
        return this.suggestContainer.style.display === "none";
    }

    clear() {
        this.suggestEl.empty();
        this.suggestContainer.style.display = "none";
    }

    close() {
        this.suggestContainer.detach();
    }
}
