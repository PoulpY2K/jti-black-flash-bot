import {AudioPlayerStatus} from "@discordjs/voice";
import type {CommandInteraction, Guild} from "discord.js";
import {
    ApplicationCommandOptionType,
    EmbedBuilder,
    GuildMember,
} from "discord.js";
import YouTube from "youtube-sr";

import {
    ArgsOf,
    ButtonComponent,
    Discord,
    On,
    Slash,
    SlashOption,
} from "discordx";
import {QueueNode, RepeatMode} from "@discordx/music";
import {bot} from "../main.js";
import {formatDurationFromMS, Queue} from "./queue.js";

@Discord()
export class music {
    queueNode: QueueNode;
    guildQueue = new Map<string, Queue>();

    getQueue(guildId: string): Queue {
        let queue = this.guildQueue.get(guildId);
        if (!queue) {
            queue = new Queue({
                client: bot,
                guildId,
                queueNode: this.queueNode,
            });

            this.guildQueue.set(guildId, queue);
        }

        return queue;
    }

    async processJoin(
        interaction: CommandInteraction
    ): Promise<{ guild: Guild; member: GuildMember; queue: Queue } | null> {
        await interaction.deferReply();

        if (
            !interaction.guild ||
            !interaction.channel ||
            !(interaction.member instanceof GuildMember)
        ) {
            await interaction.followUp(
                "> I apologize, but I am currently unable to process your request. Please try again later."
            );

            setTimeout(() => interaction.deleteReply(), 15e3);
            return null;
        }

        const {guild, member} = interaction;

        if (!member.voice.channel) {
            await interaction.followUp(
                "> It seems like you are not currently in a voice channel"
            );

            setTimeout(() => interaction.deleteReply(), 15e3);
            return null;
        }

        const queue = this.getQueue(guild.id);

        const bot = guild.members.cache.get(interaction.client.user.id);
        if (!bot?.voice.channelId) {
            queue.setChannel(interaction.channel);
            queue.join({
                channelId: member.voice.channel.id,
                guildId: guild.id,
            });
            if (bot && !bot.voice.serverDeaf) {
                await bot.voice.setDeaf(true);
            }
        } else if (bot.voice.channelId !== member.voice.channelId) {
            await interaction.followUp(
                "> I am not in your voice channel, therefore I cannot execute your request"
            );

            setTimeout(() => interaction.deleteReply(), 15e3);
            return null;
        }

        return {guild, member, queue};
    }

    constructor() {
        this.queueNode = new QueueNode(bot);
    }

    @On({event: "voiceStateUpdate"})
    handleVoiceState([, newState]: ArgsOf<"voiceStateUpdate">): void {
        if (
            newState.member?.user.id === newState.client.user.id &&
            newState.channelId === null
        ) {
            const guildId = newState.guild.id;
            const queue = this.guildQueue.get(guildId);
            if (queue) {
                queue.exit();
                this.guildQueue.delete(guildId);
            }
        }
    }

    @Slash({description: "Lancer de la musique depuis YouTube"})
    async play(
        @SlashOption({
            description: "URL ou titre de la musique",
            name: "search",
            required: true,
            type: ApplicationCommandOptionType.String,
        })
            songName: string,
        @SlashOption({
            description: "Temps en secondes",
            name: "seek",
            required: false,
            type: ApplicationCommandOptionType.Number,
        })
            seek: number | undefined,
        interaction: CommandInteraction
    ): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue, member} = rq;

        const video = await YouTube.searchOne(songName).catch(() => null);
        if (!video) {
            await interaction.followUp(
                `> Could not found song with keyword: \`${songName}\``
            );
            return;
        }

        queue.addTrack({
            duration: video.duration,
            seek,
            thumbnail: video.thumbnail?.url,
            title: video.title ?? "NaN",
            url: video.url,
            user: member.user,
        });

        if (!queue.currentTrack) {
            queue.playNext();
        }

        const embed = new EmbedBuilder();
        embed.setTitle("Enqueued");
        embed.setDescription(
            `Enqueued song **${video.title} (${formatDurationFromMS(
                video.duration
            )})**`
        );

        if (video.thumbnail?.url) {
            embed.setThumbnail(video.thumbnail?.url);
        }

        await interaction.followUp({embeds: [embed]});
    }

    @Slash({description: "Jouer une playlist YouTube"})
    async playlist(
        @SlashOption({
            description: "URL ou nom de la playlist",
            name: "search",
            required: true,
            type: ApplicationCommandOptionType.String,
        })
            playlistName: string,
        @SlashOption({
            description: "Temps en secondes",
            name: "seek",
            required: false,
            type: ApplicationCommandOptionType.Number,
        })
            seek: number | undefined,
        interaction: CommandInteraction
    ): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue, member} = rq;

        const search = await YouTube.search(playlistName, {
            limit: 1,
            type: "playlist",
        });

        const playlist = search[0];

        if (!playlist?.id) {
            await interaction.followUp("The playlist could not be found");
            return;
        }

        const pl = await YouTube.getPlaylist(playlist.id, {fetchAll: true});

        const tracks = pl.videos.map((video) => ({
            duration: video.duration,
            seek,
            thumbnail: video.thumbnail?.url,
            title: video.title ?? "NaN",
            url: video.url,
            user: member.user,
        }));

        queue.addTrack(...tracks);

        if (!queue.currentTrack) {
            queue.playNext();
        }

        const embed = new EmbedBuilder();
        embed.setTitle("Enqueued");
        embed.setDescription(
            `Enqueued  **${tracks.length}** songs from playlist **${playlist.title}**`
        );

        if (playlist.thumbnail?.url) {
            embed.setThumbnail(playlist.thumbnail.url);
        }

        await interaction.followUp({embeds: [embed]});
    }

    @Slash({description: "Démarrer la piste en cours à partir d'un certain point"})
    async seek(
        @SlashOption({
            description: "Temps en secondes",
            name: "seek",
            required: true,
            type: ApplicationCommandOptionType.Number,
        })
            seconds: number,
        interaction: CommandInteraction
    ): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        const currentTrack = queue.currentTrack;

        if (!currentTrack) {
            await interaction.followUp(
                "> There doesn't seem to be anything to seek at the moment."
            );
            return;
        }

        const time = seconds * 1000;

        if (time >= currentTrack.duration) {
            await interaction.followUp(
                `> Time should not be greater then ${formatDurationFromMS(
                    currentTrack.duration
                )}`
            );
            return;
        }

        currentTrack.seek = seconds;
        queue.addTrackFirst(currentTrack);
        queue.skip();

        const embed = new EmbedBuilder();
        embed.setTitle("Seeked");
        embed.setDescription(
            `Playing **${currentTrack.title}**** from **${formatDurationFromMS(
                time
            )}/${formatDurationFromMS(currentTrack.duration)}**`
        );

        await interaction.followUp({embeds: [embed]});
    }

    @Slash({description: "Afficher la file d'attente"})
    async queue(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;
        await queue.view(interaction);
    }

    @Slash({description: "Mettre en pause la piste en cours"})
    async pause(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        const currentTrack = queue.currentTrack;

        if (!currentTrack || !queue.isPlaying) {
            await interaction.followUp("> I am already quiet, amigo!");
            return;
        }

        queue.pause();
        await interaction.followUp(`> paused ${currentTrack.title}`);
    }

    @Slash({description: "Reprendre la piste en cours"})
    async resume(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        const currentTrack = queue.currentTrack;

        if (!currentTrack || queue.isPlaying) {
            await interaction.followUp("> no no no, I am already doing my best, amigo!");
            return;
        }

        queue.unpause();
        await interaction.followUp(`> resuming ${currentTrack.title}`);
    }

    @Slash({description: "Passer la piste en cours de lecture"})
    async skip(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        const currentTrack = queue.currentTrack;

        if (!currentTrack) {
            await interaction.followUp(
                "> There doesn't seem to be anything to skip at the moment."
            );
            return;
        }

        queue.skip();
        await interaction.followUp(`> skipped ${currentTrack.title}`);
    }

    @Slash({description: "Régler le volume", name: "set-volume"})
    async setVolume(
        @SlashOption({
            description: "Régler le volume",
            maxValue: 100,
            minValue: 0,
            name: "volume",
            required: true,
            type: ApplicationCommandOptionType.Number,
        })
            volume: number,
        interaction: CommandInteraction
    ): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        queue.setVolume(volume);
        await interaction.followUp(`> volume set to ${volume}`);
    }

    @Slash({description: "Arrêter le bot"})
    async stop(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue, guild} = rq;

        queue.exit();
        this.guildQueue.delete(guild.id);

        await interaction.followUp("> adios amigo, see you later!");
    }

    @Slash({description: "Mélanger la file d'attente"})
    async shuffle(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;
        queue.mix();
        await interaction.followUp("> playlist shuffled!");
    }

    @Slash({description: "Afficher les commandes graphiques", name: "gui-show"})
    async guiShow(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq || !interaction.channel) {
            return;
        }

        const {queue} = rq;

        queue.setChannel(interaction.channel);
        queue.startControlUpdate();

        await interaction.followUp("> Enable GUI mode!");
    }

    @Slash({description: "Cacher les commandes graphiques", name: "gui-hide"})
    async guiHide(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq || !interaction.channel) {
            return;
        }

        const {queue} = rq;
        await queue.stopControlUpdate();
        await interaction.followUp("> Disabled GUI mode!");
    }

    @ButtonComponent({id: "btn-next"})
    async nextControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.skip();

        await interaction.deferReply();
        await interaction.deleteReply();
    }

    @ButtonComponent({id: "btn-pause"})
    async pauseControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.playerState === AudioPlayerStatus.Paused
            ? queue.unpause()
            : queue.pause();

        await interaction.deferReply();
        await interaction.deleteReply();
    }

    @ButtonComponent({id: "btn-leave"})
    async leaveControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.exit();
        this.guildQueue.delete(interaction.guildId);

        await interaction.deferReply();
        await interaction.deleteReply();
    }

    @ButtonComponent({id: "btn-repeat"})
    async repeatControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.setRepeatMode(RepeatMode.All);

        await interaction.deferReply();
        await interaction.deleteReply();
    }

    @ButtonComponent({id: "btn-queue"})
    queueControl(interaction: CommandInteraction): void {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.view(interaction).then();
    }

    @ButtonComponent({id: "btn-mix"})
    async mixControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.mix();

        await interaction.deferReply();
        await interaction.deleteReply();
    }

    @ButtonComponent({id: "btn-controls"})
    async controlsControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        await queue.updateControlMessage({force: true});

        await interaction.deferReply();
        await interaction.deleteReply();
    }

    @ButtonComponent({id: "btn-loop"})
    async loopControl(interaction: CommandInteraction): Promise<void> {
        if (!interaction.guildId) {
            return;
        }

        const queue = this.getQueue(interaction.guildId);
        queue.setRepeatMode(RepeatMode.One);

        await interaction.deferReply();
        await interaction.deleteReply();
    }
}