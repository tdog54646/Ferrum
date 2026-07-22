import { Component, HostBinding, HostListener, Input } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import deepClone from 'clone-deep'
import FuzzySearch from 'fuzzy-search'

import { ConfigService } from '../services/config.service'
import { ProfilesService } from '../services/profiles.service'
import { AppService } from '../services/app.service'
import { PlatformService } from '../api/platform'
import { ProfileProvider } from '../api/index'
import { PartialProfileGroup, ProfileGroup, PartialProfile, Profile } from '../index'
import { BaseComponent } from './base.component'

interface CollapsableProfileGroup extends ProfileGroup {
    collapsed: boolean
    children: PartialProfileGroup<CollapsableProfileGroup>[]
}

/** @hidden */
@Component({
    selector: 'profile-tree',
    styleUrls: ['./profileTree.component.scss'],
    templateUrl: './profileTree.component.pug',
})
export class ProfileTreeComponent extends BaseComponent {
    profileGroups: PartialProfileGroup<ProfileGroup>[] = []
    rootGroups: PartialProfileGroup<ProfileGroup>[] = []
    allServers: PartialProfile<Profile>[] = []
    servers: PartialProfile<Profile>[] = []

    filteredProfiles: PartialProfile<Profile>[] = []
    @Input() filter = ''
    selectedProfile: PartialProfile<Profile>|null = null


    panelMinWidth = 200
    panelMaxWidth = 600
    panelInternalWidth: number = parseInt(window.localStorage.profileTreeWidth ?? '260')
    panelStartWidth = this.panelInternalWidth
    panelIsResizing = false
    panelStartX = 0

    constructor (
        private app: AppService,
        private platform: PlatformService,
        private config: ConfigService,
        private profilesService: ProfilesService,
        private translate: TranslateService,
        private ngbModal: NgbModal,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        await this.loadTreeItems()
        this.subscribeUntilDestroyed(this.config.changed$, () => this.loadTreeItems())
        this.app.tabsChanged$.subscribe(() => this.tabStateChanged())
        this.app.activeTabChange$.subscribe(() => this.tabStateChanged())
    }


    private async loadTreeItems (): Promise<void> {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        let groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })

        for (const group of groups) {
            if (group.profiles?.length) {
                // remove template profiles
                group.profiles = group.profiles.filter(x => !x.isTemplate)

                // remove blocklisted profiles
                group.profiles = group.profiles.filter(x => x.id && !this.config.store.profileBlacklist.includes(x.id))
            }
        }

        if (!this.config.store.terminal.showBuiltinProfiles) { groups = groups.filter(g => g.id !== 'built-in') }

        groups.sort((a, b) => a.name.localeCompare(b.name))
        groups.sort((a, b) => (a.id === 'built-in' || !a.editable ? 1 : 0) - (b.id === 'built-in' || !b.editable ? 1 : 0))
        groups.sort((a, b) => (a.id === 'ungrouped' ? 0 : 1) - (b.id === 'ungrouped' ? 0 : 1))
        this.profileGroups = groups.map(g => ProfileTreeComponent.intoPartialCollapsableProfileGroup(g, profileGroupCollapsed[g.id] ?? false))
        this.rootGroups = this.profilesService.buildGroupTree(this.profileGroups)
        this.allServers = this.collectProfiles(this.rootGroups)
            .filter(profile => profile.type === 'ssh' || profile.type === 'telnet')
            .sort((a, b) => a.name.localeCompare(b.name))
        this.servers = [...this.allServers]
        if (this.selectedProfile?.id) {
            this.selectedProfile = this.findProfile(this.selectedProfile.id) ?? this.selectedProfile
        }
    }

    private async editProfile (profile: PartialProfile<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )

        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) { throw new Error('Cannot edit a profile without a provider') }

        modal.componentInstance.partialProfile = deepClone(profile)
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) { return }

        result.type = provider.id

        await this.profilesService.writeProfile(result)
        await this.config.save()
        await this.loadTreeItems()
    }

    private async editProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        const { EditProfileGroupModalComponent } = window['nodeRequire']('tabby-settings')

        const modal = this.ngbModal.open(
            EditProfileGroupModalComponent,
            { size: 'lg' },
        )

        modal.componentInstance.group = deepClone(group)
        modal.componentInstance.providers = this.profilesService.getProviders()

        const result: PartialProfileGroup<ProfileGroup & { group: PartialProfileGroup<CollapsableProfileGroup>, provider?: ProfileProvider<Profile> }> | null = await modal.result.catch(() => null)
        if (!result) { return }
        if (!result.group) { return }

        if (result.provider) {
            return this.editProfileGroupDefaults(result.group, result.provider)
        }

        delete result.group.collapsed
        delete result.group.children
        await this.profilesService.writeProfileGroup(result.group)
        await this.config.save()
    }

    private async editProfileGroupDefaults (group: PartialProfileGroup<CollapsableProfileGroup>, provider: ProfileProvider<Profile>): Promise<void> {
        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')

        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const model = group.defaults?.[provider.id] ?? {}
        model.type = provider.id
        modal.componentInstance.profile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (result) {
            // Fully replace the config
            for (const k in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[k]
            }
            Object.assign(model, result)
            if (!group.defaults) {
                group.defaults = {}
            }
            group.defaults[provider.id] = model
        }
        return this.editProfileGroup(group)
    }

    async profileContextMenu (profile: PartialProfile<Profile>, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.selectedProfile = profile

        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: this.translate.instant('New session'),
                click: () => this.openNewSession(profile),
            },
            {
                type: 'separator',
            },
            {
                type: 'normal',
                label: this.translate.instant('Edit profile'),
                click: () => this.editProfile(profile),
                enabled: this.canManageProfile(profile),
            },
            {
                type: 'normal',
                label: this.translate.instant('Delete profile'),
                click: () => this.deleteProfile(profile),
                enabled: this.canManageProfile(profile),
            },
        ])
    }

    async groupContextMenu (group: PartialProfileGroup<CollapsableProfileGroup>, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.platform.popupContextMenu([
            {
                type: 'normal',
                label: group.collapsed ? this.translate.instant('Expand group') : this.translate.instant('Collapse group'),
                click: () => this.toggleGroupCollapse(group),
            },
            {
                type: 'normal',
                label: this.translate.instant('Edit group'),
                click: () => this.editProfileGroup(group),
                enabled: group.editable,
            },
        ])
    }

    private async tabStateChanged (): Promise<void> {
        const profile = this.profileForTab(this.app.activeTab)
        if (profile?.id) {
            this.selectedProfile = this.findProfile(profile.id) ?? profile
        }
    }

    async launchProfile<P extends Profile> (profile: PartialProfile<P>): Promise<any> {
        return this.profilesService.launchProfile(profile)
    }

    async selectProfile (profile: PartialProfile<Profile>, event?: MouseEvent): Promise<void> {
        event?.preventDefault()
        this.selectedProfile = profile
        const openTab = [...this.app.tabs].reverse().find(tab => this.tabContainsProfile(tab, profile.id))
        if (openTab) {
            this.app.selectTab(openTab)
            return
        }
        await this.profilesService.openNewTabForProfile(profile)
    }

    async openNewSession (profile: PartialProfile<Profile>, event?: MouseEvent): Promise<void> {
        event?.preventDefault()
        event?.stopPropagation()
        this.selectedProfile = profile
        await this.profilesService.openNewTabForProfile(profile)
    }

    async openSessionForSelectedProfile (): Promise<boolean> {
        const profile = this.selectedProfile ?? this.profileForTab(this.app.activeTab)
        if (!profile) {
            return false
        }
        this.selectedProfile = profile.id ? this.findProfile(profile.id) ?? profile : profile
        await this.profilesService.openNewTabForProfile(this.selectedProfile)
        return true
    }

    get canManageSelectedProfile (): boolean {
        return Boolean(this.selectedProfile && this.canManageProfile(this.selectedProfile))
    }

    async editSelectedProfile (): Promise<void> {
        if (!this.selectedProfile || !this.canManageSelectedProfile) {
            return
        }
        await this.editProfile(this.selectedProfile)
    }

    async deleteSelectedProfile (): Promise<void> {
        const profile = this.selectedProfile
        if (!profile || !this.canManageSelectedProfile) {
            return
        }
        await this.deleteProfile(profile)
    }

    private canManageProfile (profile: PartialProfile<Profile>): boolean {
        return !profile.isBuiltin && !profile.isTemplate
    }

    private async deleteProfile (profile: PartialProfile<Profile>): Promise<void> {
        if (!this.canManageProfile(profile)) {
            return
        }
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Delete "{name}"?', profile),
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Keep'),
            ],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response !== 0) {
            return
        }
        await this.profilesService.deleteProfile(profile)
        await this.config.save()
        this.selectedProfile = null
        await this.loadTreeItems()
    }

    isSelectedProfile (profile: PartialProfile<Profile>): boolean {
        return Boolean(profile.id && profile.id === this.selectedProfile?.id)
    }

    hasOpenSession (profile: PartialProfile<Profile>): boolean {
        return this.app.tabs.some(tab => this.tabContainsProfile(tab, profile.id))
    }

    profileDescription (profile: PartialProfile<Profile>): string {
        return this.profilesService.getDescription(profile) ?? ''
    }

    async refreshProfiles (): Promise<void> {
        await this.loadTreeItems()
    }

    async createNewSSHConnection (): Promise<void> {
        const template = (await this.profilesService.getProfiles())
            .find(profile => profile.type === 'ssh' && profile.isTemplate)
        if (!template) {
            throw new Error('SSH profile template is unavailable')
        }

        const profile: PartialProfile<Profile> = deepClone(template)
        delete profile.id
        profile.name = ''
        profile.isBuiltin = false
        profile.isTemplate = false

        const { EditProfileModalComponent } = window['nodeRequire']('tabby-settings')
        const modal = this.ngbModal.open(EditProfileModalComponent, { size: 'lg' })
        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) {
            throw new Error('SSH profile provider is unavailable')
        }

        modal.componentInstance.partialProfile = profile
        modal.componentInstance.profileProvider = provider
        const result: PartialProfile<Profile>|null = await modal.result.catch(() => null)
        if (!result) {
            return
        }

        result.type = provider.id
        if (!result.name) {
            const configProxy = this.profilesService.getConfigProxyForProfile(result)
            result.name = provider.getSuggestedName(configProxy) ?? this.translate.instant('SSH connection')
        }

        await this.profilesService.newProfile(result)
        await this.config.save()
        await this.loadTreeItems()
        this.selectedProfile = result.id ? this.findProfile(result.id) ?? result : result
    }

    private tabContainsProfile (tab: any, profileID?: string): boolean {
        if (!profileID) {
            return false
        }
        const leaves = typeof tab?.getAllTabs === 'function' ? tab.getAllTabs() : [tab]
        return leaves.some((leaf: any) => leaf?.profile?.id === profileID)
    }

    private profileForTab (tab: any): PartialProfile<Profile>|null {
        if (!tab) {
            return null
        }
        const focused = typeof tab.getFocusedTab === 'function' ? tab.getFocusedTab() : null
        if (focused?.profile) {
            return focused.profile
        }
        const leaves = typeof tab.getAllTabs === 'function' ? tab.getAllTabs() : [tab]
        return leaves.find((leaf: any) => leaf?.profile)?.profile ?? null
    }

    private findProfile (id: string): PartialProfile<Profile>|null {
        const visit = (groups: PartialProfileGroup<CollapsableProfileGroup>[]): PartialProfile<Profile>|null => {
            for (const group of groups) {
                const profile = group.profiles?.find(x => x.id === id)
                if (profile) {
                    return profile
                }
                const child = visit(group.children ?? [])
                if (child) {
                    return child
                }
            }
            return null
        }
        return visit(this.rootGroups)
    }

    private collectProfiles (groups: PartialProfileGroup<CollapsableProfileGroup>[]): PartialProfile<Profile>[] {
        const profiles: PartialProfile<Profile>[] = []
        for (const group of groups) {
            profiles.push(...(group.profiles ?? []))
            profiles.push(...this.collectProfiles(group.children ?? []))
        }
        return profiles
    }

    async onFilterChange (): Promise<void> {
        try {
            const q = this.filter.trim().toLowerCase()

            if (q.length === 0) {
                this.servers = [...this.allServers]
                return
            }
            this.servers = new FuzzySearch(
                this.allServers,
                ['name', 'description'],
                { sort: false },
            ).search(q)
        } catch (error) {
            console.error('Error occurred during search:', error)
        }
    }

    async clearFilter (): Promise<void> {
        this.filter = ''
        await this.onFilterChange()
    }

    ////// RESIZING //////
    startResize (event: MouseEvent): void {
        this.panelIsResizing = true
        this.panelStartX = event.clientX
        this.panelStartWidth = this.panelWidth
        event.preventDefault()
    }

    @HostListener('document:mousemove', ['$event'])
    onMouseMove (event: MouseEvent): void {
        if (!this.panelIsResizing) { return }
        const delta = event.clientX - this.panelStartX
        const width = Math.min(Math.max(this.panelMinWidth, this.panelStartWidth + delta), this.panelMaxWidth)
        this.panelWidth = width
        window.localStorage.profileTreeWidth = width
    }

    @HostListener('document:mouseup')
    stopResize (): boolean {
        this.panelIsResizing = false
        return true
    }

    @HostBinding('style.width.px')
    get panelWidth (): number {
        return this.panelInternalWidth
    }

    set panelWidth (value: number) {
        this.panelInternalWidth = value
    }

    ////// GROUP COLLAPSING //////
    toggleGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        group.collapsed = !group.collapsed
        this.saveProfileGroupCollapse(group)
    }

    private saveProfileGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        profileGroupCollapsed[group.id] = group.collapsed
        window.localStorage.profileGroupCollapsed = JSON.stringify(profileGroupCollapsed)
    }

    private static intoPartialCollapsableProfileGroup (group: PartialProfileGroup<ProfileGroup>, collapsed: boolean): PartialProfileGroup<CollapsableProfileGroup> {
        const collapsableGroup = {
            ...group,
            collapsed,
        }
        return collapsableGroup
    }

}
