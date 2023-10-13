import type {CommandInteraction, Guild} from "discord.js";
import {ApplicationCommandOptionType, EmbedBuilder, GuildMember,} from "discord.js";
import YouTube from "youtube-sr";

import {ArgsOf, Discord, On, Slash, SlashOption,} from "discordx";
import {QueueNode, RepeatMode} from "@discordx/music";
import {bot} from "../main.js";
import {formatDurationFromMS, Queue} from "../music/queue";

@Discord()
export class player {
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
                "> Je suis désolé, mais je n'arrive pas à traiter votre demande. Veuillez réessayer plus tard."
            );

            setTimeout(() => interaction.deleteReply(), 15e3);
            return null;
        }

        const {guild, member} = interaction;

        if (!member.voice.channel) {
            await interaction.followUp(
                "> Il semblerait que vous ne soyez pas dans un salon vocal. Veuillez vous connecter."
            );

            setTimeout(() => interaction.deleteReply(), 15e3);
            return null;
        }

        const queue = this.getQueue(guild.id);

        const bot = guild.members.cache.get(interaction.client.user.id);
        if (!bot?.voice.channelId) {
            queue.join({
                channelId: member.voice.channel.id,
                guildId: guild.id,
            });
            if (bot && !bot.voice.serverDeaf) {
                await bot.voice.setDeaf(true);
            }
        } else if (bot.voice.channelId !== member.voice.channelId) {
            await interaction.followUp(
                "> Je ne suis pas dans votre salon vocal, je ne peux donc pas traiter votre demande."
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
                `> Je ne parviens pas à trouver une piste avec les mots-clés suivants : \`${songName}\``
            );
            return;
        }

        queue.addTrack({
            duration: video.duration,
            seek,
            thumbnail: video.thumbnail?.url,
            title: video.title ?? "Aucun",
            url: video.url,
            user: member.user,
        });

        if (!queue.currentTrack) {
            queue.playNext();
        }

        const embed = new EmbedBuilder();
        embed.setTitle("En file d'attente");
        embed.setDescription(
            `Mise en file d'attente de **${video.title} (${formatDurationFromMS(
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
            await interaction.followUp("> La playlist est introuvable.");
            return;
        }

        const pl = await YouTube.getPlaylist(playlist.id, {fetchAll: true});

        const tracks = pl.videos.map((video) => ({
            duration: video.duration,
            seek,
            thumbnail: video.thumbnail?.url,
            title: video.title ?? "Aucun",
            url: video.url,
            user: member.user,
        }));

        queue.addTrack(...tracks);

        if (!queue.currentTrack) {
            queue.playNext();
        }

        const embed = new EmbedBuilder();
        embed.setTitle("En file d'attente");
        embed.setDescription(
            `Mise en file d'attente de **${tracks.length}** pistes depuis la playlist **${playlist.title}**`
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
                "> Il semblerait qu'il n'y ait aucune piste à traiter pour le moment."
            );
            return;
        }

        const time = seconds * 1000;

        if (time >= currentTrack.duration) {
            await interaction.followUp(
                `> La durée ne devrait pas être plus grande que ${formatDurationFromMS(
                    currentTrack.duration
                )}`
            );
            return;
        }

        currentTrack.seek = seconds;
        queue.addTrackFirst(currentTrack);
        queue.skip();

        const embed = new EmbedBuilder();
        embed.setTitle("Trouvé");
        embed.setDescription(
            `Lecture de **${currentTrack.title}**** à **${formatDurationFromMS(
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
            await interaction.followUp("> Je suis déjà silencieux !");
            return;
        }

        queue.pause();
        await interaction.followUp(`> Mise en pause de ${currentTrack.title}`);
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
            await interaction.followUp("> Je fais déjà de mon mieux !");
            return;
        }

        queue.unpause();
        await interaction.followUp(`> Reprise de ${currentTrack.title}`);
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
                "> Il semblerait qu'il n'y ait aucune piste en cours de lecture."
            );
            return;
        }

        queue.skip();
        await interaction.followUp(`> ${currentTrack.title} a bien été passé`);
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
        await interaction.followUp(`> Volume réglé à ${volume}`);
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

        await interaction.followUp("> À plus tard !");
    }

    @Slash({description: "Mélanger la file d'attente"})
    async shuffle(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;
        queue.mix();
        await interaction.followUp("> Playlist mélangée !");
    }

    @Slash({description: "Boucler la piste en cours"})
    async loop(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        if (queue.repeatMode === RepeatMode.One) {
            queue.setRepeatMode(RepeatMode.None);
            await interaction.followUp("> Annulation de la lecture de la piste en boucle !");
        } else {
            queue.setRepeatMode(RepeatMode.One)
            await interaction.followUp("> Lecture de la piste en boucle !");
        }
    }

    @Slash({name:"loop-all", description: "Boucler la file d'attente"})
    async loopQueue(interaction: CommandInteraction): Promise<void> {
        const rq = await this.processJoin(interaction);
        if (!rq) {
            return;
        }

        const {queue} = rq;

        if (queue.repeatMode === RepeatMode.All) {
            queue.setRepeatMode(RepeatMode.None);
            await interaction.followUp("> Annulation de la lecture de la file d'attente en boucle !");
        } else {
            queue.setRepeatMode(RepeatMode.All)
            await interaction.followUp("> Lecture de la file d'attente en boucle !");
        }
    }
}
