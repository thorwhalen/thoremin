<!-- Source: https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h -->

Skip to content

Navigation menu [ ](</>)

Search [ Powered by Algolia Search ](<https://www.algolia.com/developers/?utm_source=devto&utm_medium=referral>)

[ Log in ](<https://dev.to/enter?signup_subforem=1>) [ Create account ](<https://dev.to/enter?signup_subforem=1&state=new-user>)

## DEV Community

Close

Add reaction 

Like  Unicorn  Exploding Head  Raised Hands  Fire 

Jump to Comments  Save  Boost 

More...

Copy link Copy link

Copied to Clipboard

[ Share to X ](<https://twitter.com/intent/tweet?text=%22Lyria%20RealTime%3A%20The%20Developer%E2%80%99s%20Guide%20to%20Infinite%20Music%20Streaming%22%20by%20Guillaume%20Vernade%20%23DEVCommunity%20https%3A%2F%2Fdev.to%2Fgoogleai%2Flyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h>) [ Share to LinkedIn ](<https://www.linkedin.com/shareArticle?mini=true&url=https%3A%2F%2Fdev.to%2Fgoogleai%2Flyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h&title=Lyria%20RealTime%3A%20The%20Developer%E2%80%99s%20Guide%20to%20Infinite%20Music%20Streaming&summary=You%20love%20generating%20static%20songs%20with%20classic%20text%20to%20music%20models%3F%20Prepare%20to%20conduct%20a%20never-ending...&source=DEV%20Community>) [ Share to Facebook ](<https://www.facebook.com/sharer.php?u=https%3A%2F%2Fdev.to%2Fgoogleai%2Flyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h>) [ Share to Mastodon ](<https://s2f.kytta.dev/?text=https%3A%2F%2Fdev.to%2Fgoogleai%2Flyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h>)

Share Post via... [Report Abuse](</report-abuse>)

[ ](<https://media2.dev.to/dynamic/image/width=1000,height=420,fit=cover,gravity=auto,format=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2Fvdb5ud5lnkn58z5nj5z5.jpeg>)

[](</googleai>) [ ](</giom_v>)

[Guillaume Vernade](</giom_v>) for [Google AI](</googleai>)

Posted on Dec 8, 2025

         

#  Lyria RealTime: The Developer’s Guide to Infinite Music Streaming 

[#gemini](</t/gemini>) [#lyria](</t/lyria>) [#tutorial](</t/tutorial>) [#music](</t/music>)

You love generating static songs with classic text to music models? Prepare to conduct a never-ending symphony. Introducing **[Lyria RealTime](<https://deepmind.google/models/lyria/lyria-realtime/>)** , Google DeepMind’s experimental model that doesn't just generate music—it _jams_ with you like it did during the Toro y Moi IO pre-show:

While traditional music generation models work like a jukebox (input prompt -> wait -> get song), Lyria RealTime operates on the principle of **"Music as a Verb."** It creates a persistent, bidirectional streaming connection that produces a continuous 48kHz stereo stream. You can steer, warp, and morph the audio in the moment, making it the first generative model truly designed for interactive experiences.

And the best part? Right now the model is **free to use**!

Here's quick summary of what you'll learn about in this guide:  
[](<https://media2.dev.to/dynamic/image/width=800%2Cheight=%2Cfit=scale-down%2Cgravity=auto%2Cformat=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2Fe91qwp3ixq4cqnpqmuvk.jpeg>)

* * *

This guide will walk you through building with Lyria RealTime using the Gemini API.

**This guide will cover:**

  1. **How Lyria RealTime Works (The "Goldfish Memory" Architecture)**
  2. **Project Setup**
  3. **Basic Streaming (The "Hello World" of Music)**
  4. **Steering the Stream (Weighted Prompts)**
  5. **Advanced Configuration (BPM, Density, & Scale)**
  6. **Blueprints for the Future: Advanced Use Cases**
  7. **Prompting Strategies & Best Practices**
  8. **Where to play with Lyria Real Time**



Jump directly to the last section if you want to play directly with Lyria RealTime, for ex. as a [DJ](<https://aistudio.google.com/apps/bundled/promptdj-midi>), driving a [spaceship](<https://aistudio.google.com/apps/bundled/spacedj>) or using your [camera](<https://aistudio.google.com/apps/bundled/lyria_camera>).

> **Note** : for an interactive version of this post, checkout the [python cookbook](<https://colab.research.google.com/github/google-gemini/cookbook/blob/main/quickstarts/Get_started_LyriaRealTime.ipynb>).

* * *

##  1) How Lyria RealTime Works 

Lyria RealTime uses a low-latency WebSocket connection to maintain a live communication channel with the model. Unlike offline models that plan a whole song structure (Intro-Verse-Chorus), Lyria operates on a **chunk-based autoregression** system.

[](<https://media2.dev.to/dynamic/image/width=800%2Cheight=%2Cfit=scale-down%2Cgravity=auto%2Cformat=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2Fb2uub6nyc7bnp6e61saa.gif>)

It generates audio in 2-second chunks, looking back for a few seconds of context to maintain the rhythmic "groove" while looking forward at your current controls to decide the style. This means the model doesn't "compose songs" in the traditional sense; it navigates musical states.

* * *

##  2) Project Setup 

To follow this guide, you will need:

  * An API key from Google AI Studio (it can be a free one).
  * The Google Gen AI SDK.



**Install the SDK:**  
**Python** (`3.12+` recommended):  

    
    
    pip install "google-genai>=1.52.0"
    

Enter fullscreen mode Exit fullscreen mode

**JavaScript / TypeScript:**  
You'll need at least the 1.30 version of the [JS/TS SDK](<https://googleapis.github.io/js-genai/>)  

    
    
    npm install @google/genai
    

Enter fullscreen mode Exit fullscreen mode

> **Note** : The following examples use the Python SDK for demonstration. For JS/TS code sample, check the [AI studio Apps](<https://aistudio.google.com/apps/bundled/promptdj-midi?showAssistant=true&showCode=true>).

* * *

##  3) Basic Streaming 

To start a session, you connect to the model (`models/lyria-realtime-exp`), send an initial configuration, and start the stream. The interaction loop is asynchronous: you send commands, and the server continuously yields raw audio chunks.

_[Note: Ensure you are using the`v1alpha` API version for experimental models like Lyria]_.  

    
    
    import asyncio
    from google import genai
    from google.genai import types
    
    client = genai.Client(http_options={'api_version': 'v1alpha'})
    
    async def main():
        async def receive_audio(session):
            """Background task to process incoming audio chunks."""
            while True:
                async for message in session.receive():
                    if message.server_content.audio_chunks:
                        # 'data' is raw 16-bit PCM audio at 48kHz
                        audio_data = message.server_content.audio_chunks.data
                        # Add your audio playback logic here!
                await asyncio.sleep(10**-12)
    
        async with (
            client.aio.live.music.connect(model='models/lyria-realtime-exp') as session,
            asyncio.TaskGroup() as tg,
        ):
            # 1. Start listening for audio
            tg.create_task(receive_audio(session))
    
            # 2. Send initial musical concept
            await session.set_weighted_prompts(
                prompts=[types.WeightedPrompt(text='elevator music', weight=1.0)]
            )
    
            # 3. Set the vibe (BPM, Temperature)
            await session.set_music_generation_config(
                config=types.LiveMusicGenerationConfig(bpm=90, temperature=1.0)
            )
    
            # 4. Drop the beat
            await session.play()
    
            # Keep the session alive
            await asyncio.sleep(30) 
    
    if __name__ == "__main__":
        asyncio.run(main())
    

Enter fullscreen mode Exit fullscreen mode

Congratulations, you've got some elevator music!

Not impressed? That's just the beginning, dear padawan, now comes the cool part.

* * *

##  4) Steering the Stream (Weighted Prompts) 

This is where the magic happens. Unlike static generation, you can send new `WeightedPrompt` messages _while the music is playing_ to smoothly transition the genre, instruments, or mood.

The `weight` parameter is your fader. A weight of `1.0` is standard, but you can use multiple prompts to blend influences.

**Example: Morphing from Piano to Live Performance**  

    
    
    from google.genai import types
    
    # Send this while the loop is running to shift the style
    await session.set_weighted_prompts(
        prompts=[
            # Keep the piano strong
            {"text": "Piano", "weight": 2.0},
            # Add a subtle meditative layer
            types.WeightedPrompt(text="Meditation", weight=0.5),
            # Push the 'Live' feeling
            types.WeightedPrompt(text="Live Performance", weight=1.0),
        ]
    )
    

Enter fullscreen mode Exit fullscreen mode

> **Note:** As the model generates chunks after chunks, the changes can take a few seconds (usually around 2s) to be reflected in the music.

####  Pro Tip: Cross-fading 

Drastic prompt changes can be abrupt. For professional results, implement client-side cross-fading by sending intermediate weight values rapidly (e.g., every 500ms) to "morph" the music smoothly.

**Example: The "Morph" Function**  

    
    
    import asyncio
    from google.genai import types
    
    async def cross_fade(session, old_prompt, new_prompt, duration=2.0, steps=10):
        """Smoothly morphs from one musical idea to another."""
        step_time = duration / steps
    
        for i in range(steps + 1):
            # Calculate the blend ratio (alpha goes from 0.0 to 1.0)
            alpha = i / steps
    
            await session.set_weighted_prompts(
                prompts=[
                    # Fade out the old
                    types.WeightedPrompt(text=old_prompt, weight=1.0 - alpha),
                    # Fade in the new
                    types.WeightedPrompt(text=new_prompt, weight=alpha),
                ]
            )
            await asyncio.sleep(step_time)
    
    # Usage in your main loop:
    # Morph from 'Ambient' to 'Techno' over 5 seconds
    await cross_fade(session, "Ambient Drone", "Hard Techno", duration=5.0)
    

Enter fullscreen mode Exit fullscreen mode

Note that this code sample assumes all your prompts have a weight of 1 which might not be the case. 

* * *

##  5) Advanced Configuration (The Knobs) 

Lyria RealTime exposes parametric controls that change the structure of the music. If you aren't a musician, think of these controls as the physics of the audio world:

  * **Density** (0.0 - 1.0): Think of this as "Busyness." 
    * _Low_ (0.1): A lonely drummer playing once every few seconds. Sparse.
    * _High_ (0.9): A chaotic orchestra where everyone plays at once. Intense.
  * **Brightness** (0.0 - 1.0): Think of this as "Muffled vs. Crisp." 
    * _Low_ (0.1): Listening to music from outside a club, through a wall. Dark and bass-heavy.
    * _High_ (0.9): Listening through high-end headphones. Sharp, clear, and treble-heavy.
  * **BPM** (60 - 200): The heartbeat of the track (Beats Per Minute).
  * **Scale** : The "Mood." It forces the music into a specific set of notes (Key/Mode).



> **Important** : While density and brightness can be changed smoothly on the fly, changing the BPM or Scale is a fundamental structural shift. You must call `reset_context()` for these changes to take effect. This will clear the model's "short-term memory," causing a hard cut in the audio.

**Example: The "Hard Drop"**  

    
    
    # Changing structural parameters requires a context reset
    await session.set_music_generation_config(
        config=types.LiveMusicGenerationConfig(
            bpm=140, 
            scale=types.Scale.C_MAJOR_A_MINOR, # Force happy/neutral mood
        )
    )
    
    # This command is mandatory for BPM/Scale changes to apply!
    await session.reset_context()
    

Enter fullscreen mode Exit fullscreen mode

* * *

##  6) Blueprints for the Future: Advanced Use Cases 

We’ve covered basic streaming, but Lyria’s parametric controls allow for applications that connect the physical world to the audio stream. Here are four ideas to get you started.

###  Use Case A: The "Biometric Beat" (Fitness & Health) 

Most fitness apps use static playlists that rarely match your actual pace. Because Lyria allows for real-time `bpm` and `density` control, you can build a music engine that is biologically coupled to the user.

  * **Heart Rate Monitor (HRM) - > BPM:** Map the user's heart rate directly to the track's tempo.
  * **Accelerometer - > Density:** If the user is sprinting (high variance in movement), increase `density` to `1.0` to add percussion and complexity. If they stop to rest, drop `density` to `0.2` for an ambient breakdown.



###  Use Case B: The "Democratic DJ" (Social Streaming) 

Since `WeightedPrompts` accept float values, you can build a collaborative radio station for Twitch streams or Discord bots where the audience votes on the genre. Instead of a winner-take-all system, Lyria can blend the votes.

  * **Input:** 100 users vote. 60 vote "_Cyberpunk_ ", 30 vote "_Jazz_ ", 10 vote "_Reggae_ ".
  * **Normalization:** Convert votes to weights (0.6, 0.3, 0.1).
  * **Result:** The model generates a dominant Cyberpunk track with clear Jazz harmonies and a subtle Reggae backbeat and changes it overtime according to the votes.



###  Use Case C: "Focus Flow" (Productivity) 

Deep work requires different audio textures than brainstorming. You can map Lyria's `brightness` and `guidance` parameters to a Pomodoro timer to guide the user's cognitive state.

  * **Deep Work Phase:** Low `brightness` (darker, warmer sounds), Low `density` (minimal distractions), High `guidance` (repetitive, predictable).
  * **Break Phase:** High `brightness` (energetic, crisp), High `density`, Low `guidance` (creative, surprising).



###  Use Case D: "Realtime Game music" (Gaming) 

Coming from the gaming industry I could not avoid thinking of a gaming idea for Lyria Real Time. You could have Lyria create the music of the game in real time based on:

  * **The game's own style:** a bunch of prompts that defines the game and the overall ambiance,
  * **The environment:** different prompts depending on whether you're in a busy city, in a forest or sailing the Greek seas,
  * **The player's action:** are they fighting, then add the "epic" prompt, investigating instead, change it for the "mysterious" one,
  * **The players' current condition:** You could change the BPM and the weight of a "danger" prompt depending on the player's health bar. The lower it is, the more stressful the music would be.



* * *

##  7) Prompting Strategies & Best Practices 

**The Prompt Formula:**  
Through testing, a reliable formula has emerged: **[Genre Anchor] + [Instrumentation] + [Atmosphere]**...

  * **Instruments:** _303 Acid Bass, Buchla Synths, Hang Drum, TR-909 Drum Machine_...
  * **Genres:** _Acid Jazz, Bengal Baul, Glitch Hop, Shoegaze, Vaporwave_...
  * **Moods:** _Crunchy Distortion, Ethereal Ambience, Ominous Drone, Swirling Phasers_...



**Developer Best Practices:**

  * **Buffer Your Audio:** Because this is real-time streaming over the network, implement client-side audio buffering (2-3 chunks) to handle network jitter and ensure smooth playback.
  * **The "Settling" Period:** When you start a stream or reset context, the model needs about 5-10 seconds to "settle" into a stable groove.
  * **Safety Filters:** The model checks prompts against safety filters. Avoid asking for specific copyrighted artists ("Style of Taylor Swift"); instead, deconstruct their sound into descriptors ("Pop, female vocals, acoustic guitar").
  * **Instrumental Only:** The model is only instrumental. While you can set `music_generation_mode` to `VOCALIZATION`, it produces vocal-like textures (oohs/aahs), not coherent lyrics.
  * **Session duration limit:** The session are currently limited to 10mn, but you can just restart a new one afterwards.



More details and prompt ideas in Lyria RealTime's [documentation](<https://ai.google.dev/gemini-api/docs/music-generation>).

* * *

##  8\. Ready to Jam? Choose your preferred way to play with Lyria RealTime 

One of the easiest places to try is AI Studio, where a couple of cool apps are available for you to play with, and to vibe-customize to your needs:

  * **[Prompt DJ](<https://aistudio.google.com/apps/bundled/promptdj>)** , **[MIDI DJ](<https://aistudio.google.com/apps/bundled/promptdj-midi>)** and **[MusicFX](<https://labs.google/fx/tools/music-fx-dj>)** (US only) let you add and mix multiple prompts in real time:



  * **[Space DJ](<https://aistudio.google.com/apps/bundled/spacedj>)** lets you navigate the universe of music genders with a spacecraft! I personally love navigating around the _italo-disco_ and _euro-france_ planets.



  * **[Lyria Camera](<https://aistudio.google.com/apps/bundled/lyria_camera>)** creates music in real time based on what it sees. I'd love to have that connected to my dashcam!



  * The **[Magenta website](<https://magenta.withgoogle.com/demos>)** also features a lot of cool demos. It's also a great place to get more details on Deepmind's music generation models.

  * Finally, **check the[magical mirror](<https://github.com/Giom-V/magic-mirror>) demo** I made that uses Lyria to create background music according to what it tells (Gemini generates the prompts on the fly):




And now the floor is yours, what will you create using Lyria RealTime?

####  Resources: 

  * [Documentation](<https://ai.google.dev/gemini-api/docs/music-generation>)
  * Magenta [website](<http://magenta.withgoogle.com/>) and [blog](<https://magenta.withgoogle.com/blog>) for the latest news on the music generation models.
  * AI Studio [gen-media apps](<https://aistudio.google.com/apps?source=showcase&showcaseTag=gen-media>)



[](<https://media2.dev.to/dynamic/image/width=800%2Cheight=%2Cfit=scale-down%2Cgravity=auto%2Cformat=auto/https%3A%2F%2Fdev-to-uploads.s3.amazonaws.com%2Fuploads%2Farticles%2Fvk7aa727myswxdfemkja.png>)

##  Top comments (9)

Subscribe

Personal Trusted User

[ Create template ](</settings/response-templates>)

Templates let you quickly answer FAQs or store snippets for re-use.

Submit Preview [Dismiss](</404.html>)

Collapse Expand

 

[ ](<https://dev.to/jess>)

[ Jess Lee  ](<https://dev.to/jess>)

Jess Lee [](</++>)

[ Jess Lee  ](</jess>)

Follow

Building DEV and Forem with everyone here. Interested in the future. 

  * Email 

[jess@majorleaguehacking.com](<mailto:jess@majorleaguehacking.com>)

  * Location 

USA / TAIWAN 

  * Pronouns 

she/they 

  * Work 

Co-Founder & COO at Forem 

  * Joined 

Jul 29, 2016




• [ Dec 9 '25  ](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-32pnh>)

Dropdown menu

  * [Copy link](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-32pnh>)
  *   * Hide 
  *   *   * 


[@mikeydorje](<https://dev.to/mikeydorje>) thought you'd be interested in this one!

Like comment:  Like comment:  4 likes Like  Comment button Reply

Collapse Expand

 

[ ](<https://dev.to/mikeydorje>)

[ Mikey Dorje  ](<https://dev.to/mikeydorje>)

Mikey Dorje [](</++>)

[ Mikey Dorje  ](</mikeydorje>)

Follow

Musician who codes 

  * Email 

[mikey@tonethreads.com](<mailto:mikey@tonethreads.com>)

  * Location 

Montréal 

  * Education 

Maritime Conservatory of Music 

  * Pronouns 

He/him 

  * Work 

Musician/Music Producer | Developer/Owner: ToneThreads | Developer: Forem 

  * Joined 

Dec 31, 2017




• [ Dec 10 '25  ](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-330fe>)

Dropdown menu

  * [Copy link](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-330fe>)
  *   * Hide 
  *   *   * 


Thanks [@jess](<https://dev.to/jess>)! I totally plan on diving in to this further. It's wild. I love Toro y Moi too. His performance with it for the IO pre-show was fantastic!

Like comment:  Like comment:  3 likes Like  Comment button Reply

Collapse Expand

 

[ ](<https://dev.to/avanichols_dev>)

[ Ava Nichols  ](<https://dev.to/avanichols_dev>)

Ava Nichols 

[ Ava Nichols  ](</avanichols_dev>)

Follow

Just a dev 

  * Joined 

Sep 1, 2023




• [ Dec 8 '25  ](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-32p93>)

Dropdown menu

  * [Copy link](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-32p93>)
  *   * Hide 
  *   *   * 


Whoa

Like comment:  Like comment:  4 likes Like  Comment button Reply

Collapse Expand

 

[ ](<https://dev.to/knmeiss>)

[ Kourtney Meiss  ](<https://dev.to/knmeiss>)

Kourtney Meiss 

[ Kourtney Meiss  ](</knmeiss>)

Follow

Developer Advocate @ Amazon for Devices 

  * Pronouns 

She/Her 

  * Joined 

Jul 30, 2025




• [ Dec 16 '25  ](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-333l1>)

Dropdown menu

  * [Copy link](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-333l1>)
  *   * Hide 
  *   *   * 


this was a fun little side project, thanks! 

Like comment:  Like comment:  2 likes Like  Comment button Reply

Collapse Expand

 

[ ](<https://dev.to/chance600>)

[ Alec Brewer  ](<https://dev.to/chance600>)

Alec Brewer 

[ Alec Brewer  ](</chance600>)

Follow

  * Joined 

Jan 2, 2026




• [ Jan 2  • Edited on Jan 2 • Edited ](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-33bhe>)

Dropdown menu

  * [Copy link](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-33bhe>)
  *   * Hide 
  *   *   * 


Incredible writeup tysm!

Message me to collab on similar projects!

Like comment:  Like comment:  2 likes Like  Comment button Reply

Collapse Expand

 

[ ](<https://dev.to/benjamin_nguyen_8ca6ff360>)

[ Benjamin Nguyen  ](<https://dev.to/benjamin_nguyen_8ca6ff360>)

Benjamin Nguyen 

[ Benjamin Nguyen  ](</benjamin_nguyen_8ca6ff360>)

Follow

I am a freelance data scientist on UpWork with a strong track record—delivering data-driven solutions that empower strategy, security, and innovation 

  * Email 

[nguyenben85@gmail.com](<mailto:nguyenben85@gmail.com>)

  * Location 

Ottawa, Ontario 

  * Pronouns 

Ben 

  * Work 

Data Scientist (Freelance) 

  * Joined 

Jul 4, 2024




• [ Dec 9 '25  ](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-32pb9>)

Dropdown menu

  * [Copy link](<https://dev.to/googleai/lyria-realtime-the-developers-guide-to-infinite-music-streaming-4m1h#comment-32pb9>)
  *   * Hide 
  *   *   * 


wow

Like comment:  Like comment:  2 likes Like  Comment button Reply

Some comments may only be visible to logged-in visitors. [Sign in](</enter>) to view all comments. 

[Code of Conduct](</code-of-conduct>) • [Report abuse](</report-abuse>)

Are you sure you want to hide this comment? It will become hidden in your post, but will still be visible via the comment's permalink. 

Hide child comments as well

Confirm 

For further actions, you may consider blocking this person and/or [reporting abuse](</report-abuse>)

[ Google AI  ](</googleai>)

Follow

Making AI helpful for everyone. 

Ready to build with AI? 

###  More from [Google AI](</googleai>)

[ Gemini 3.1 Flash-Lite: Developer guide and use cases  #gemini #ai #coding ](</googleai/gemini-31-flash-lite-developer-guide-and-use-cases-1hh>) [ Gemini 3.1 Flash-Lite: Built for intelligence at scale  #gemini #ai #vertexai ](</googleai/gemini-31-flash-lite-built-for-intelligence-at-scale-3i8e>) [ Detecting and Editing Visual Objects with Gemini  #machinelearning #gemini #imagegeneration #objectdetection ](</googleai/detecting-and-editing-visual-objects-with-gemini-116p>)

💎 DEV Diamond Sponsors 

Thank you to our Diamond Sponsors for supporting the DEV Community 

[ ](<https://aistudio.google.com/?utm_source=partner&utm_medium=partner&utm_campaign=FY25-Global-DEVpartnership-sponsorship-AIS&utm_content=-&utm_term=-&bb=146443>)

Google AI is the official AI Model and Platform Partner of DEV

[ ](<https://neon.tech/?ref=devto&bb=146443>)

Neon is the official database partner of DEV

[ ](<https://www.algolia.com/developers/?utm_source=devto&utm_medium=referral&bb=146443>)

Algolia is the official search partner of DEV

[DEV Community](</>) — A space to discuss and keep up software development and manage your software career 



* [ Home ](</>)
* [ Reading List ](</readinglist>)
* [ About ](</about>)
* [ Contact ](</contact>)
* [ MLH ](<https://mlh.io/>)



* [ Code of Conduct ](</code-of-conduct>)
* [ Privacy Policy ](</privacy>)
* [ Terms of Use ](</terms>)

Built on [Forem](<https://www.forem.com>) — the [open source](<https://dev.to/t/opensource>) software that powers [DEV](<https://dev.to>) and other inclusive communities.

Made with love and [Ruby on Rails](<https://dev.to/t/rails>). DEV Community © 2016 - 2026.

We're a place where coders share, stay up-to-date and grow their careers. 

[ Log in ](<https://dev.to/enter?signup_subforem=1>) [ Create account ](<https://dev.to/enter?signup_subforem=1&state=new-user>)
