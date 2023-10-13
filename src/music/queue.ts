import type {
    CommandInteraction,
    User,
} from "discord.js";
import {
    Message,
} from "discord.js";

import {
    Pagination,
    PaginationResolver,
    PaginationType,
} from "@discordx/pagination"
import type {Track} from "@discordx/music"
import {TrackQueue} from "@discordx/music";

export interface MyTrack extends Track {
    duration: number;
    thumbnail?: string;
    title: string;
    user: User;
}

export function formatDurationFromMS(duration: number): string {
    const seconds = Math.floor((duration / 1e3) % 60);
    const minutes = Math.floor((duration / 6e4) % 60);
    const hours = Math.floor(duration / 36e5);
    const secondsPad = `${seconds}`.padStart(2, "0");
    const minutesPad = `${minutes}`.padStart(2, "0");
    const hoursPad = `${hours}`.padStart(2, "0");
    return `${hours ? `${hoursPad}:` : ""}${minutesPad}:${secondsPad}`;
}

export class Queue extends TrackQueue<MyTrack> {
    private async deleteMessage(message: Message): Promise<void> {
        if (message.deletable) {
            // ignore any exceptions in delete action
            await message.delete().catch(() => null);
        }
    }

    public async view(interaction: CommandInteraction): Promise<void> {
        const currentTrack = this.currentTrack;
        if (!currentTrack) {
            const pMsg = await interaction.followUp({
                content: "> Impossible de traiter la file d'attente, réessayez plus tard!",
                ephemeral: true,
            });
            setTimeout(() => this.deleteMessage(pMsg), 3000);
            return;
        }

        if (!this.queueSize) {
            const pMsg = await interaction.followUp({
                content: `> Lecture de **${currentTrack.title}**`,
                embeds: currentTrack.thumbnail
                    ? [{image: {url: currentTrack.thumbnail}}]
                    : [],
            });

            setTimeout(() => this.deleteMessage(pMsg), 1e4);
            return;
        }

        const current = `> Lecture de **${currentTrack.title}** sur ${
            this.queueSize + 1
        }`;

        const pageOptions = new PaginationResolver((index, paginator) => {
            paginator.maxLength = this.queueSize / 10;
            if (index > paginator.maxLength) {
                paginator.currentPage = 0;
            }

            const currentPage = paginator.currentPage;

            const queue = this.tracks
                .slice(currentPage * 10, currentPage * 10 + 10)
                .map(
                    (track, index1) =>
                        `${currentPage * 10 + index1 + 1}. ${track.title}` +
                        ` (${formatDurationFromMS(track.duration)})`
                )
                .join("\n\n");

            return {content: `${current}\n\`\`\`markdown\n${queue}\`\`\``};
        }, Math.floor(this.queueSize / 10));

        await new Pagination(interaction, pageOptions, {
            enableExit: true,
            time: 6e4,
            type:
                Math.floor(this.queueSize / 10) <= 5
                    ? PaginationType.Button
                    : PaginationType.SelectMenu,
        }).send();
    }

    public exit(): void {
        this.leave();
    }
}
