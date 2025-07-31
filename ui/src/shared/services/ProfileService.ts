import { ProfilesStore, ProfilesClient } from "@holochain-open-dev/profiles";
import type { AppClient } from "@holochain/client";

export function createProfilesStore(client: AppClient): ProfilesStore {
    const profilesClient = new ProfilesClient(client, "profiles_role");
    
    const config = {
        avatarMode: "avatar-optional" as const,
        additionalFields: [], 
        minNicknameLength: 3
    };
    
    return new ProfilesStore(profilesClient, config);
}